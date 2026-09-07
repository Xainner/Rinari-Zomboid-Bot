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
