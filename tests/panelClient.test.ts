import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PanelClient } from '../src/panel/client.js';
import { PanelAuth } from '../src/panel/auth.js';
import { PolicyError } from '../src/panel/types.js';

describe('panel client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function clientWithFetch(handler: (url: string, init?: RequestInit) => unknown): PanelClient {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => handler(url, init)));
    const auth = new PanelAuth({ baseUrl: 'http://x', username: 'u', password: 'p', timeoutMs: 1000 });
    (auth as unknown as { accessToken: string }).accessToken = 'tok';
    return new PanelClient({ baseUrl: 'http://x', serverName: 'ARKNO2', timeoutMs: 1000, auth });
  }

  function json(data: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => data, headers: new Headers() } as Response;
  }

  it('blocks mutation on server mismatch', async () => {
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/servers/active')) return json({ server: { serverName: 'OTRO' } });
      return json({});
    });
    await expect(c.restartServer(5)).rejects.toBeInstanceOf(PolicyError);
  });

  it('blocks mutation on empty serverName', async () => {
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/servers/active')) return json({ server: null });
      return json({});
    });
    await expect(c.saveWorld()).rejects.toBeInstanceOf(PolicyError);
  });

  it('maps 409 conflict distinctly', async () => {
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/servers/active')) return json({ server: { serverName: 'ARKNO2' } });
      if (url.endsWith('/api/server/restart')) return json({ error: 'busy' }, 409);
      return json({});
    });
    await expect(c.restartServer(5)).rejects.toMatchObject({ status: 409 });
  });

  it('parses tracked mods wrapped in { mods }', async () => {
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/mods/status')) return json({ totalModsTracked: 272, updatesAvailable: 0 });
      if (url.endsWith('/api/mods/tracked')) return json({ mods: [{ workshop_id: '1' }, { workshop_id: '2' }] });
      if (url.endsWith('/api/scheduler/status')) return json({});
      return json({});
    });
    const r = await c.getModStatus();
    expect(r.tracked).toBe(272);
    expect(r.updatesAvailable).toBe(0);
    expect(r.pendingRestart).toBe(false);
  });

  it('falls back to mods array length when status lacks totals', async () => {
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/mods/status')) return json({});
      if (url.endsWith('/api/mods/tracked')) return json({ mods: [{ workshop_id: '1' }] });
      if (url.endsWith('/api/scheduler/status')) return json({});
      return json({});
    });
    const r = await c.getModStatus();
    expect(r.tracked).toBe(1);
  });

  it('never leaks secrets in errors', async () => {
    const c = clientWithFetch(() => json({ error: 'bad' }, 500));
    try {
      await c.getPlayers();
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain('tok');
    }
  });

  it('ranks player hours desc and caps at top 10', async () => {
    const stats = Array.from({ length: 12 }, (_, i) => ({
      player_name: `P${i}`,
      total_playtime_seconds: (i + 1) * 3600,
      session_count: i + 1,
      first_seen: '2026-08-13T00:00:00.000Z',
      last_seen: '2026-09-08T00:00:00.000Z',
      last_session_start: null,
    }));
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/players/stats')) return json({ stats });
      return json({});
    });
    const r = await c.getPlayerHours();
    expect(r.scope).toBe('ranking');
    expect(r.tracked).toBe(12);
    expect(r.ranking).toHaveLength(10);
    expect(r.ranking![0].player).toBe('P11');
    expect(r.ranking![0].hours).toBe(12);
    expect(r.ranking![0].online).toBe(false);
  });

  it('adds the live ongoing session to hours', async () => {
    const start = new Date(Date.now() - 3600 * 1000).toISOString();
    const c = clientWithFetch((url) => {
      if (url.includes('/api/players/stats/')) {
        return json({
          stat: {
            player_name: 'Wachita',
            total_playtime_seconds: 3600,
            session_count: 3,
            first_seen: '2026-08-13T00:00:00.000Z',
            last_seen: start,
            last_session_start: start,
          },
        });
      }
      return json({});
    });
    const r = await c.getPlayerHours('wachita');
    expect(r.scope).toBe('player');
    expect(r.found).toBe(true);
    expect(r.entry!.online).toBe(true);
    // 1h stored + ~1h live session
    expect(r.entry!.hours).toBeGreaterThanOrEqual(1.9);
    expect(r.entry!.hours).toBeLessThan(2.5);
  });

  it('reports unknown player as not found', async () => {
    const c = clientWithFetch((url) => {
      if (url.includes('/api/players/stats/')) return json({ stat: null });
      return json({});
    });
    const r = await c.getPlayerHours('Nadie');
    expect(r.found).toBe(false);
    expect(r.entry).toBeUndefined();
  });

  it('filters activity by player and hides moderation actions', async () => {
    const logs = [
      { player_name: 'Diegol', action: 'death', details: 'non-pvp death at (1,2,0)', logged_at: '2026-09-08T01:00:00.000Z' },
      { player_name: 'Diegol', action: 'kick', details: 'kicked', logged_at: '2026-09-08T01:01:00.000Z' },
      { player_name: 'Otro', action: 'death', details: 'PvP death at (3,4,0)', logged_at: '2026-09-08T01:02:00.000Z' },
      { player_name: 'DIEGOL', action: 'connect', details: 'Player connected to server', logged_at: '2026-09-08T01:03:00.000Z' },
    ];
    const c = clientWithFetch((url) => {
      if (url.includes('/api/players/activity')) return json({ success: true, logs });
      return json({});
    });
    const r = await c.getPlayerActivity('diegol', 'death', 10);
    expect(r.count).toBe(1);
    expect(r.events[0]).toMatchObject({ player: 'Diegol', action: 'death' });
  });

  it('caps activity limit', async () => {
    const logs = Array.from({ length: 25 }, () => ({
      player_name: 'P',
      action: 'connect',
      details: 'x',
      logged_at: '2026-09-08T01:00:00.000Z',
    }));
    const c = clientWithFetch((url) => {
      if (url.includes('/api/players/activity')) return json({ success: true, logs });
      return json({});
    });
    const r = await c.getPlayerActivity(undefined, undefined, 20);
    expect(r.count).toBe(20);
  });
});
