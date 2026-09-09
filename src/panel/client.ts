import { PanelAuth } from './auth.js';
import { ActiveServer, Arkno2Status, BackupsResult, BackupSummary, DeathRankingResult, ModStatusResult, ModUpdatesDetailResult, NextMaintenanceResult, PanelError, PlayerActivityEvent, PlayerActivityResult, PlayerHoursEntry, PlayerHoursResult, PlayerModerationResult, PlayerPosition, PlayerPositionResult, PlayersResult, PolicyError, RecentErrorsResult, WorldInfoResult } from './types.js';
import { sanitizeConsoleLine, sanitizeServerMessage } from '../security/sanitize.js';
import { logger } from '../util/logger.js';

export interface PanelClientOptions {
  baseUrl: string;
  serverName: string;
  timeoutMs: number;
  auth: PanelAuth;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class PanelClient {
  constructor(private opts: PanelClientOptions) {}

  private async call<T>(method: string, path: string, body?: unknown, opts?: { retryGet?: boolean }): Promise<T> {
    const attempt = async (token: string): Promise<T> => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs);
      try {
        const res = await fetch(`${this.opts.baseUrl}${path}`, {
          method,
          signal: ctrl.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (res.status === 401) throw new PanelError('Unauthorized', 401, 'UNAUTHORIZED');
        if (res.status === 403) throw new PanelError('Forbidden', 403, 'FORBIDDEN');
        if (res.status === 409) throw new PanelError('Conflict: operation already in progress', 409, 'CONFLICT');
        if (!res.ok) throw new PanelError(`Panel request failed: ${method} ${path}`, res.status);
        if (res.status === 204) return undefined as T;
        return (await res.json().catch(() => undefined)) as T;
      } finally {
        clearTimeout(t);
      }
    };

    const isGet = method === 'GET';
    const tries = isGet && opts?.retryGet !== false ? 2 : 1;
    let lastErr: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        return await this.opts.auth.withAuthRetry(attempt);
      } catch (err) {
        lastErr = err;
        if (err instanceof PanelError && (err.status === 401 || err.status === 403 || err.status === 409)) throw err;
        if (!isGet) throw err;
        if (i < tries - 1) await sleep(300 * (i + 1));
      }
    }
    throw lastErr;
  }

  async getActiveServer(): Promise<{ server: ActiveServer | null; raw: unknown }> {
    const raw = await this.call<unknown>('GET', '/api/servers/active');
    const obj = raw as Record<string, unknown> | null;
    const serverObj = (obj?.['server'] ?? obj) as Record<string, unknown> | null;
    if (!serverObj || typeof serverObj['serverName'] !== 'string') {
      return { server: null, raw };
    }
    return {
      server: {
        id: typeof serverObj['id'] === 'string' ? (serverObj['id'] as string) : undefined,
        serverName: serverObj['serverName'] as string,
        isActive: true,
        raw,
      },
      raw,
    };
  }

  async assertArkno2Active(): Promise<void> {
    const { server } = await this.getActiveServer();
    if (!server || server.serverName !== this.opts.serverName) {
      throw new PolicyError(`Active server mismatch: expected ${this.opts.serverName}`);
    }
  }

  async getArkno2Status(): Promise<Arkno2Status> {
    const status = await this.call<Record<string, unknown>>('GET', '/api/servers/active/status');
    let consoleErrors = 0;
    try {
      const ec = await this.call<Record<string, unknown>>('GET', '/api/server/console-log/error-count');
      const n = ec?.['count'] ?? ec?.['errorCount'] ?? 0;
      if (typeof n === 'number') consoleErrors = n;
    } catch {
      consoleErrors = 0;
    }
    const pick = (v: unknown): string => (typeof v === 'string' ? v : 'unknown');
    return {
      ok: true,
      server: this.opts.serverName,
      host: pick(status?.['host'] ?? status?.['server'] ?? status?.['state']),
      rcon: pick(status?.['rcon']),
      panelBridge: pick(status?.['panelBridge'] ?? status?.['bridge']),
      consoleErrors,
    };
  }

  async getPlayers(): Promise<PlayersResult> {
    const data = await this.call<unknown>('GET', '/api/players');
    const arr = Array.isArray(data) ? data : (data as Record<string, unknown>)?.['players'];
    const list = Array.isArray(arr) ? arr : [];
    const names = list
      .map((p) => (typeof p === 'string' ? p : (p as Record<string, unknown>)?.['name']))
      .filter((n): n is string => typeof n === 'string');
    return { ok: true, server: this.opts.serverName, count: names.length, players: names };
  }

  /** Gameplay actions safe to expose. Moderation history stays out of the bot. */
  static readonly gameplayActions: readonly string[] = ['connect', 'disconnect', 'death'];

  private static toHoursEntry(raw: Record<string, unknown>): PlayerHoursEntry | null {
    const name = raw['player_name'];
    if (typeof name !== 'string' || name.trim().length === 0) return null;
    let total = typeof raw['total_playtime_seconds'] === 'number' ? raw['total_playtime_seconds'] : 0;
    const startRaw = raw['last_session_start'];
    let online = false;
    if (typeof startRaw === 'string' && startRaw.length > 0) {
      const startMs = Date.parse(startRaw);
      if (!Number.isNaN(startMs)) {
        online = true;
        // Stored total excludes the ongoing session: add the live delta.
        total += Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      }
    }
    const sessions = typeof raw['session_count'] === 'number' ? raw['session_count'] : 0;
    const firstSeen = typeof raw['first_seen'] === 'string' ? (raw['first_seen'] as string) : null;
    const lastSeen = typeof raw['last_seen'] === 'string' ? (raw['last_seen'] as string) : null;
    return {
      player: name,
      hours: Math.round((total / 3600) * 10) / 10,
      sessions,
      online,
      firstSeen,
      lastSeen,
    };
  }

  private static assertPlayerName(name: unknown): string {
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 64) {
      throw new PolicyError('player_name must be a string of length 1..64');
    }
    // Mirror the panel's username guard: no control chars, quotes or backslash.
    // eslint-disable-next-line no-control-regex
    if (!/^[^\x00-\x1F\x7F"\\]{1,64}$/.test(name.trim())) {
      throw new PolicyError('player_name has an invalid format');
    }
    return name.trim();
  }

  async getPlayerHours(playerName?: string): Promise<PlayerHoursResult> {
    if (playerName !== undefined) {
      const clean = PanelClient.assertPlayerName(playerName);
      const data = await this.call<Record<string, unknown>>(
        'GET',
        `/api/players/stats/${encodeURIComponent(clean)}`,
      );
      const raw = (data?.['stat'] ?? data) as Record<string, unknown> | null;
      if (!raw || typeof raw['player_name'] !== 'string') {
        return { ok: true, server: this.opts.serverName, scope: 'player', found: false };
      }
      const entry = PanelClient.toHoursEntry(raw);
      if (!entry) return { ok: true, server: this.opts.serverName, scope: 'player', found: false };
      return { ok: true, server: this.opts.serverName, scope: 'player', found: true, entry };
    }
    const data = await this.call<Record<string, unknown>>('GET', '/api/players/stats');
    const arr = Array.isArray(data?.['stats']) ? (data['stats'] as Record<string, unknown>[]) : [];
    const entries = arr
      .map((r) => PanelClient.toHoursEntry(r))
      .filter((e): e is PlayerHoursEntry => e !== null)
      .sort((a, b) => b.hours - a.hours);
    return {
      ok: true,
      server: this.opts.serverName,
      scope: 'ranking',
      tracked: entries.length,
      ranking: entries.slice(0, 10),
    };
  }

  async getPlayerActivity(playerName?: string, action?: string, limit = 10): Promise<PlayerActivityResult> {
    const clean = playerName === undefined ? undefined : PanelClient.assertPlayerName(playerName);
    if (action !== undefined && !PanelClient.gameplayActions.includes(action)) {
      throw new PolicyError(`action must be one of: ${PanelClient.gameplayActions.join(', ')}`);
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new PolicyError('limit must be an integer in range 1..20');
    }
    // Over-fetch when filtering so the final slice still has enough events.
    const fetchLimit = clean || action ? Math.min(Math.max(limit * 5, limit), 100) : limit;
    const data = await this.call<Record<string, unknown>>('GET', `/api/players/activity?limit=${fetchLimit}`);
    const logs = Array.isArray(data?.['logs']) ? (data['logs'] as Record<string, unknown>[]) : [];
    const events: PlayerActivityEvent[] = [];
    for (const log of logs) {
      const act = log['action'];
      if (typeof act !== 'string' || !PanelClient.gameplayActions.includes(act)) continue;
      if (action !== undefined && act !== action) continue;
      const pname = log['player_name'];
      if (typeof pname !== 'string') continue;
      if (clean !== undefined && pname.toLowerCase() !== clean.toLowerCase()) continue;
      const details = typeof log['details'] === 'string' ? log['details'] : '';
      const at = typeof log['logged_at'] === 'string' ? (log['logged_at'] as string) : '';
      events.push({ player: pname, action: act, details: details.slice(0, 200), at });
      if (events.length >= limit) break;
    }
    return { ok: true, server: this.opts.serverName, count: events.length, events };
  }

  async getDeathRanking(limit = 5): Promise<DeathRankingResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new PolicyError('limit must be an integer in range 1..10');
    }
    const data = await this.call<Record<string, unknown>>('GET', '/api/players/activity?limit=100');
    const logs = Array.isArray(data?.['logs']) ? (data['logs'] as Record<string, unknown>[]) : [];
    const counts = new Map<string, number>();
    let windowDeaths = 0;
    for (const log of logs) {
      if (log['action'] !== 'death' || typeof log['player_name'] !== 'string') continue;
      windowDeaths++;
      counts.set(log['player_name'] as string, (counts.get(log['player_name'] as string) ?? 0) + 1);
    }
    const ranking = [...counts.entries()]
      .map(([player, deaths]) => ({ player, deaths }))
      .sort((a, b) => b.deaths - a.deaths)
      .slice(0, limit);
    return { ok: true, server: this.opts.serverName, windowDeaths, ranking };
  }

  async getModUpdatesDetail(): Promise<ModUpdatesDetailResult> {
    const data = await this.call<Record<string, unknown>>('GET', '/api/mods/tracked');
    const raw = data?.['mods'];
    const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
    const updates = list
      .filter((m) => m['update_available'] === 1 || m['update_available'] === true)
      .map((m) => ({
        workshop_id: String(m['workshop_id'] ?? ''),
        name: typeof m['name'] === 'string' && m['name'].length > 0 ? (m['name'] as string) : String(m['workshop_id'] ?? ''),
      }))
      .filter((m) => m.workshop_id.length > 0)
      .slice(0, 50);
    return { ok: true, server: this.opts.serverName, count: updates.length, updates };
  }

  async getNextMaintenance(): Promise<NextMaintenanceResult> {
    const s = await this.call<Record<string, unknown>>('GET', '/api/scheduler/status');
    const rawNext = s?.['nextRun'] as Record<string, unknown> | null | undefined;
    const next =
      rawNext && typeof rawNext['label'] === 'string' && typeof rawNext['at'] === 'string'
        ? { label: rawNext['label'] as string, at: rawNext['at'] as string }
        : null;
    return {
      ok: true,
      server: this.opts.serverName,
      next,
      autoRestart: s?.['autoRestartEnabled'] === true,
      backupScheduled: s?.['backupScheduleEnabled'] === true,
    };
  }

  private static toBackupSummary(raw: Record<string, unknown>): BackupSummary | null {
    if (typeof raw['name'] !== 'string') return null;
    return {
      name: raw['name'] as string,
      size: typeof raw['size'] === 'number' ? (raw['size'] as number) : 0,
      created: typeof raw['created'] === 'string' ? (raw['created'] as string) : '',
    };
  }

  async getBackups(limit = 5): Promise<BackupsResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new PolicyError('limit must be an integer in range 1..10');
    }
    const status = await this.call<Record<string, unknown>>('GET', '/api/backup/status');
    const listRaw = await this.call<Record<string, unknown>>('GET', '/api/backup/list');
    const arr = Array.isArray(listRaw?.['backups']) ? (listRaw['backups'] as Record<string, unknown>[]) : [];
    const recent = arr
      .map((b) => PanelClient.toBackupSummary(b))
      .filter((b): b is BackupSummary => b !== null)
      .slice(0, limit);
    const lastRaw = status?.['lastBackup'] as Record<string, unknown> | null | undefined;
    // NOTE: paths (path, savesPath) are deliberately stripped: names+sizes suffice.
    return {
      ok: true,
      server: this.opts.serverName,
      enabled: status?.['enabled'] === true,
      schedule: typeof status?.['schedule'] === 'string' ? (status['schedule'] as string) : null,
      backupCount: typeof status?.['backupCount'] === 'number' ? (status['backupCount'] as number) : recent.length,
      backupInProgress: status?.['backupInProgress'] === true,
      lastBackup: lastRaw ? PanelClient.toBackupSummary(lastRaw) : null,
      recent,
    };
  }

  async getWorldInfo(): Promise<WorldInfoResult> {
    const get = (path: string): Promise<Record<string, unknown> | null> =>
      this.call<Record<string, unknown>>('GET', path)
        .then((r) => ((r?.['data'] as Record<string, unknown>) ?? r ?? null) as Record<string, unknown> | null)
        .catch(() => null);
    const [weather, time, world] = await Promise.all([
      get('/api/panel-bridge/weather'),
      get('/api/panel-bridge/time'),
      get('/api/panel-bridge/world/stats'),
    ]);
    if (!weather && !time && !world) {
      return { ok: true, server: this.opts.serverName, available: false };
    }
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const out: WorldInfoResult = { ok: true, server: this.opts.serverName, available: true };
    if (time) {
      out.time = {
        year: num(time['year']) ?? 0,
        month: num(time['month']) ?? 0,
        day: num(time['day']) ?? 0,
        hour: Math.floor(num(time['hour']) ?? 0),
        minute: num(time['minute']) ?? 0,
        nightsSurvived: num(time['nightsSurvived']) ?? 0,
      };
    }
    if (weather) {
      out.weather = {
        temperature: num(weather['temperature']) ?? 0,
        raining: weather['isRaining'] === true,
        snowing: weather['isSnowing'] === true,
        storm: weather['isThunderStorming'] === true,
        fog: num(weather['fogIntensity']) ?? 0,
        clouds: num(weather['cloudIntensity']) ?? 0,
      };
    }
    if (world) {
      const z = num(world['zombiesInCell']);
      if (z !== null) out.zombies = Math.floor(z);
      if (typeof world['map'] === 'string') out.map = world['map'] as string;
    }
    return out;
  }

  async getRecentErrors(limit = 10): Promise<RecentErrorsResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new PolicyError('limit must be an integer in range 1..20');
    }
    const data = await this.call<Record<string, unknown>>(
      'GET',
      `/api/server/console-log?filter=errors&lines=${limit}`,
    );
    const raw = Array.isArray(data?.['lines']) ? (data['lines'] as unknown[]) : [];
    const lines = raw
      .filter((l): l is string => typeof l === 'string')
      .map((l) => sanitizeConsoleLine(l))
      .filter((l) => l.length > 0)
      .slice(0, limit);
    return { ok: true, server: this.opts.serverName, count: lines.length, lines };
  }

  private static toPosition(raw: Record<string, unknown>): PlayerPosition | null {
    const name = raw['name'] ?? raw['username'] ?? raw['player_name'];
    const x = raw['x'];
    const y = raw['y'];
    if (typeof name !== 'string' || typeof x !== 'number' || typeof y !== 'number') return null;
    return {
      player: name,
      x: Math.floor(x),
      y: Math.floor(y),
      z: typeof raw['z'] === 'number' ? Math.floor(raw['z'] as number) : 0,
      health: typeof raw['health'] === 'number' ? Math.round((raw['health'] as number) * 10) / 10 : 100,
    };
  }

  async getPlayerPosition(playerName?: string): Promise<PlayerPositionResult> {
    const clean = playerName === undefined ? undefined : PanelClient.assertPlayerName(playerName);
    let data: Record<string, unknown> | null;
    try {
      // server-info works; the per-player bridge command is currently broken
      // server-side (Lua pcall error), so always fetch all and filter here.
      data = await this.call<Record<string, unknown>>('GET', '/api/panel-bridge/server-info');
    } catch {
      return { ok: true, server: this.opts.serverName, available: false };
    }
    const inner = (data?.['data'] as Record<string, unknown>) ?? data;
    const arr = Array.isArray(inner?.['players']) ? (inner['players'] as Record<string, unknown>[]) : [];
    const positions = arr
      .map((p) => PanelClient.toPosition(p))
      .filter((p): p is PlayerPosition => p !== null);
    if (clean !== undefined) {
      const entry = positions.find((p) => p.player.toLowerCase() === clean.toLowerCase());
      if (!entry) return { ok: true, server: this.opts.serverName, available: true, scope: 'player', found: false };
      return { ok: true, server: this.opts.serverName, available: true, scope: 'player', found: true, entry };
    }
    return { ok: true, server: this.opts.serverName, available: true, scope: 'all', count: positions.length, positions };
  }

  // ─── Admin-only player moderation ──────────────────────────────────────
  // Every method asserts the active server first and refuses to report
  // success unless the panel confirms it (RCON routinely fails against
  // offline players with HTTP 200 + { success: false }).

  private static assertSafeText(reason: unknown): string | undefined {
    if (reason === undefined) return undefined;
    if (typeof reason !== 'string' || reason.length > 256) {
      throw new PolicyError('reason must be a string of at most 256 characters');
    }
    // Mirror the panel's SAFE_TEXT guard (trailing - is a literal hyphen).
    if (!/^[a-zA-Z0-9\s.,!?'":;()@#&+=%_\u00C0-\u024F-]{0,256}$/.test(reason)) {
      throw new PolicyError('reason has an invalid format');
    }
    return reason;
  }

  private static assertItemId(item: unknown): string {
    if (typeof item !== 'string' || item.length < 1 || item.length > 64) {
      throw new PolicyError('item must be a string like Base.Axe (1..64 chars)');
    }
    if (!/^[A-Za-z0-9_]+\.[A-Za-z0-9_&#+.-]+$/.test(item)) {
      throw new PolicyError('item must look like Module.ItemName (e.g. Base.Axe)');
    }
    return item;
  }

  private assertModerationSuccess(data: unknown, label: string): Record<string, unknown> {
    const obj = data as Record<string, unknown> | null;
    if (obj && typeof obj['success'] === 'boolean' && obj['success'] === false) {
      const detail = typeof obj['error'] === 'string' ? (obj['error'] as string) : label;
      throw new Error(`Panel reported failure: ${detail}`.slice(0, 300));
    }
    return (obj ?? {}) as Record<string, unknown>;
  }

  private moderationResult(player: string, data: Record<string, unknown>): PlayerModerationResult {
    const out: PlayerModerationResult = { ok: true, server: this.opts.serverName, player };
    if (typeof data['via'] === 'string') out.via = data['via'] as string;
    if (typeof data['warning'] === 'string') out.warning = (data['warning'] as string).slice(0, 300);
    return out;
  }

  async kickPlayer(playerName: string, reason?: string): Promise<PlayerModerationResult> {
    const clean = PanelClient.assertPlayerName(playerName);
    const safeReason = PanelClient.assertSafeText(reason);
    await this.assertArkno2Active();
    const data = await this.call<unknown>(
      'POST',
      '/api/players/kick',
      safeReason === undefined ? { username: clean } : { username: clean, reason: safeReason },
    );
    logger.info('panel_mutation', { endpoint: 'kickPlayer', server: this.opts.serverName, player: clean });
    return this.moderationResult(clean, this.assertModerationSuccess(data, 'kick failed'));
  }

  async banPlayer(playerName: string, banIp?: boolean, reason?: string): Promise<PlayerModerationResult> {
    const clean = PanelClient.assertPlayerName(playerName);
    if (banIp !== undefined && typeof banIp !== 'boolean') throw new PolicyError('ban_ip must be a boolean');
    const safeReason = PanelClient.assertSafeText(reason);
    await this.assertArkno2Active();
    const data = await this.call<unknown>('POST', '/api/players/ban', {
      username: clean,
      ...(banIp === undefined ? {} : { banIp }),
      ...(safeReason === undefined ? {} : { reason: safeReason }),
    });
    logger.info('panel_mutation', { endpoint: 'banPlayer', server: this.opts.serverName, player: clean });
    return this.moderationResult(clean, this.assertModerationSuccess(data, 'ban failed'));
  }

  async unbanPlayer(playerName: string): Promise<PlayerModerationResult> {
    const clean = PanelClient.assertPlayerName(playerName);
    await this.assertArkno2Active();
    const data = await this.call<unknown>('POST', '/api/players/unban', { username: clean });
    logger.info('panel_mutation', { endpoint: 'unbanPlayer', server: this.opts.serverName, player: clean });
    return this.moderationResult(clean, this.assertModerationSuccess(data, 'unban failed'));
  }

  async teleportPlayer(
    playerName: string,
    targetPlayer?: string,
    x?: number,
    y?: number,
    z?: number,
  ): Promise<PlayerModerationResult> {
    const clean = PanelClient.assertPlayerName(playerName);
    const target = targetPlayer === undefined ? undefined : PanelClient.assertPlayerName(targetPlayer);
    const hasCoords = x !== undefined || y !== undefined || z !== undefined;
    if (target !== undefined && hasCoords) {
      throw new PolicyError('teleport takes either target_player or coordinates, not both');
    }
    if (target === undefined && (x === undefined || y === undefined)) {
      throw new PolicyError('teleport needs target_player or x and y coordinates');
    }
    let body: Record<string, unknown>;
    if (target !== undefined) {
      body = { player1: clean, player2: target };
    } else {
      const zz = z ?? 0;
      for (const [label, v, max] of [['x', x, 24000], ['y', y, 24000], ['z', zz, 8]] as const) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) {
          throw new PolicyError(`${label} must be a number in range 0..${max}`);
        }
      }
      body = { player1: clean, x, y, z: zz };
    }
    await this.assertArkno2Active();
    const data = await this.call<unknown>('POST', '/api/players/teleport', body);
    logger.info('panel_mutation', { endpoint: 'teleportPlayer', server: this.opts.serverName, player: clean });
    return this.moderationResult(clean, this.assertModerationSuccess(data, 'teleport failed'));
  }

  async giveItem(playerName: string, item: string, count = 1): Promise<PlayerModerationResult> {
    const clean = PanelClient.assertPlayerName(playerName);
    const itemId = PanelClient.assertItemId(item);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new PolicyError('count must be an integer in range 1..100');
    }
    await this.assertArkno2Active();
    const data = await this.call<unknown>('POST', '/api/players/add-item', {
      username: clean,
      item: itemId,
      count,
    });
    logger.info('panel_mutation', { endpoint: 'giveItem', server: this.opts.serverName, player: clean });
    return this.moderationResult(clean, this.assertModerationSuccess(data, 'give-item failed'));
  }

  async setGodmode(playerName: string, enabled: boolean): Promise<PlayerModerationResult> {
    const clean = PanelClient.assertPlayerName(playerName);
    if (typeof enabled !== 'boolean') throw new PolicyError('enabled must be a boolean');
    await this.assertArkno2Active();
    const data = await this.call<unknown>('POST', '/api/players/godmode', { username: clean, enabled });
    logger.info('panel_mutation', { endpoint: 'setGodmode', server: this.opts.serverName, player: clean });
    return this.moderationResult(clean, this.assertModerationSuccess(data, 'godmode failed'));
  }

  async getModStatus(): Promise<ModStatusResult> {
    const status = await this.call<Record<string, unknown>>('GET', '/api/mods/status').catch(
      (): Record<string, unknown> => ({}),
    );
    // NOTE: GET /api/mods/tracked returns { mods: [...] }, not a bare array.
    const trackedRaw = await this.call<unknown>('GET', '/api/mods/tracked').catch(() => []);
    const sched = await this.call<Record<string, unknown>>('GET', '/api/scheduler/status').catch(
      (): Record<string, unknown> => ({}),
    );
    const trackedList = Array.isArray(trackedRaw)
      ? trackedRaw
      : Array.isArray((trackedRaw as Record<string, unknown>)?.['mods'])
        ? ((trackedRaw as Record<string, unknown>)['mods'] as unknown[])
        : [];
    const tracked =
      typeof status?.['totalModsTracked'] === 'number'
        ? (status['totalModsTracked'] as number)
        : trackedList.length;
    const updatesAvailable =
      typeof status?.['updatesAvailable'] === 'number'
        ? (status['updatesAvailable'] as number)
        : typeof status?.['modsNeedingUpdate'] === 'number'
          ? (status['modsNeedingUpdate'] as number)
          : 0;
    const pending =
      (status as Record<string, unknown>)?.['pendingRestart'] === true ||
      (sched as Record<string, unknown>)?.['pendingRestart'] === true;
    return {
      ok: true,
      server: this.opts.serverName,
      summary: `${tracked} mods bajo seguimiento de updates, ${updatesAvailable} con actualizacion disponible. Reinicio pendiente: ${pending ? 'si' : 'no'}.`,
      pendingRestart: pending,
      tracked,
      updatesAvailable,
    };
  }

  async checkModUpdates(): Promise<{ ok: boolean; server: string }> {
    await this.call('POST', '/api/mods/check-updates', {});
    return { ok: true, server: this.opts.serverName };
  }

  async saveWorld(): Promise<{ ok: boolean; server: string }> {
    await this.assertArkno2Active();
    await this.call('POST', '/api/server/save', {});
    logger.info('panel_mutation', { endpoint: 'saveWorld', server: this.opts.serverName });
    return { ok: true, server: this.opts.serverName };
  }

  async restartServer(warningMinutes: number): Promise<{ ok: boolean; server: string; warningMinutes: number }> {
    if (!Number.isInteger(warningMinutes) || warningMinutes < 0 || warningMinutes > 60) {
      throw new PolicyError('warningMinutes must be an integer in range 0..60');
    }
    await this.assertArkno2Active();
    await this.call('POST', '/api/server/restart', { warningMinutes });
    logger.info('panel_mutation', { endpoint: 'restartServer', server: this.opts.serverName });
    return { ok: true, server: this.opts.serverName, warningMinutes };
  }

  async startServer(): Promise<{ ok: boolean; server: string }> {
    await this.assertArkno2Active();
    await this.call('POST', '/api/server/start', {});
    return { ok: true, server: this.opts.serverName };
  }

  async stopServer(): Promise<{ ok: boolean; server: string }> {
    await this.assertArkno2Active();
    await this.call('POST', '/api/server/stop', {});
    return { ok: true, server: this.opts.serverName };
  }

  async sendServerMessage(message: string): Promise<{ ok: boolean; server: string }> {
    const clean = sanitizeServerMessage(message);
    await this.assertArkno2Active();
    await this.call('POST', '/api/server/message', { message: clean });
    return { ok: true, server: this.opts.serverName };
  }

  async cancelPendingModRestart(): Promise<{ ok: boolean; server: string }> {
    await this.assertArkno2Active();
    await this.call('POST', '/api/mods/cancel-pending-restart', {});
    return { ok: true, server: this.opts.serverName };
  }
}
