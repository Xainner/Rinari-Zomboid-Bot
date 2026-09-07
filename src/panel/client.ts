import { PanelAuth } from './auth.js';
import { ActiveServer, Arkno2Status, ModStatusResult, PanelError, PlayersResult, PolicyError } from './types.js';
import { sanitizeServerMessage } from '../security/sanitize.js';
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
