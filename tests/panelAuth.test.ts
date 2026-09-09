import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PanelAuth } from '../src/panel/auth.js';
import { PanelError } from '../src/panel/types.js';

describe('panel auth retry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function stubFetch(handler: (url: string) => { status: number; body: unknown }): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: handler(url).status >= 200 && handler(url).status < 300,
        status: handler(url).status,
        json: async () => handler(url).body,
        headers: { get: () => null },
      })),
    );
  }

  function auth(): PanelAuth {
    return new PanelAuth({ baseUrl: 'http://x', username: 'u', password: 'p', timeoutMs: 1000 });
  }

  it('refreshes and retries once on PanelError 401', async () => {
    stubFetch((url) => {
      if (url.endsWith('/api/auth/login')) return { status: 200, body: { accessToken: 'tok1' } };
      if (url.endsWith('/api/auth/refresh')) return { status: 200, body: { accessToken: 'tok2' } };
      return { status: 200, body: {} };
    });
    const a = auth();
    let calls = 0;
    const seen: string[] = [];
    const out = await a.withAuthRetry(async (token) => {
      calls++;
      seen.push(token);
      if (calls === 1) throw new PanelError('Unauthorized', 401, 'UNAUTHORIZED');
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(calls).toBe(2);
    // First attempt used the login token, retry used the refreshed one.
    expect(seen).toEqual(['tok1', 'tok2']);
  });

  it('falls back to full login when refresh is rejected', async () => {
    stubFetch((url) => {
      if (url.endsWith('/api/auth/login')) return { status: 200, body: { accessToken: 'fresh' } };
      if (url.endsWith('/api/auth/refresh')) return { status: 401, body: { error: 'stale' } };
      return { status: 200, body: {} };
    });
    const a = auth();
    let calls = 0;
    const seen: string[] = [];
    const out = await a.withAuthRetry(async (token) => {
      calls++;
      seen.push(token);
      if (calls === 1) throw new PanelError('Unauthorized', 401, 'UNAUTHORIZED');
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(seen).toEqual(['fresh', 'fresh']);
  });

  it('does not retry on 403', async () => {
    let refreshHit = false;
    stubFetch((url) => {
      if (url.endsWith('/api/auth/login')) return { status: 200, body: { accessToken: 'tok1' } };
      if (url.endsWith('/api/auth/refresh')) {
        refreshHit = true;
        return { status: 200, body: { accessToken: 'tok2' } };
      }
      return { status: 200, body: {} };
    });
    const a = auth();
    await expect(
      a.withAuthRetry(async () => {
        throw new PanelError('Forbidden', 403, 'FORBIDDEN');
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(refreshHit).toBe(false);
  });
});
