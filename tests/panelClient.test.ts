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
});
