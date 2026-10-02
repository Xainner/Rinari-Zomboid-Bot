import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PanelClient } from '../src/panel/client.js';
import { PanelAuth } from '../src/panel/auth.js';
import { PolicyError } from '../src/panel/types.js';
import { ToolExecutor } from '../src/tools/executor.js';
import type { AppConfig } from '../src/config.js';
import { ADMIN_ONLY_TOOLS, TOOL_METADATA, validateToolArgs } from '../src/tools/registry.js';
import { buildToolDefinitions } from '../src/tools/definitions.js';

const DIAGNOSTIC_READS = ['get_installed_mods', 'get_workshop_health', 'get_server_health', 'get_community_digest'] as const;

function clientWithFetch(handler: (url: string) => unknown): PanelClient {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => handler(url)));
  const auth = new PanelAuth({ baseUrl: 'http://x', username: 'u', password: 'p', timeoutMs: 1000 });
  (auth as unknown as { accessToken: string }).accessToken = 'tok';
  return new PanelClient({ baseUrl: 'http://x', serverName: 'ARKNO2', timeoutMs: 1000, auth });
}

function json(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data, headers: new Headers() } as Response;
}

describe('installed mods', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the panel total and returns a capped slice', async () => {
    const mods = Array.from({ length: 15 }, (_, i) => ({ workshop_id: String(100 + i), name: `Mod ${i}` }));
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/mods/server-mods')) return json({ mods, total: 272 });
      return json({});
    });
    const r = await c.getInstalledMods(10);
    expect(r.total).toBe(272);
    expect(r.count).toBe(10);
    expect(r.mods[0]).toEqual({ workshop_id: '100', name: 'Mod 0' });
    expect(r.partial).toBeUndefined();
    expect(r.code).toBeUndefined();
  });

  it('accepts a bare array and falls back to the id when the name is missing', async () => {
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/mods/server-mods')) return json([{ workshop_id: '77' }, { name: 'sin id' }]);
      return json({});
    });
    const r = await c.getInstalledMods(10);
    expect(r.mods).toEqual([{ workshop_id: '77', name: '77' }]);
    expect(r.total).toBe(1);
  });

  it('filters by name or workshop id, case-insensitively', async () => {
    const mods = [
      { workshop_id: '1', name: 'Better Fuel Tank' },
      { workshop_id: '2', name: 'Simple Tires' },
    ];
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/mods/server-mods')) return json({ mods });
      return json({});
    });
    expect((await c.getInstalledMods(10, 'better')).mods).toEqual([{ workshop_id: '1', name: 'Better Fuel Tank' }]);
    expect((await c.getInstalledMods(10, '2')).mods).toEqual([{ workshop_id: '2', name: 'Simple Tires' }]);
    expect((await c.getInstalledMods(10, 'nada')).mods).toEqual([]);
  });

  it('keeps search literal: never a path, never an injected quote', async () => {
    const c = clientWithFetch(() => json({ mods: [] }));
    await expect(c.getInstalledMods(10, 'a"b')).rejects.toBeInstanceOf(PolicyError);
    await expect(c.getInstalledMods(10, 'a\\b')).rejects.toBeInstanceOf(PolicyError);
    await expect(c.getInstalledMods(10, 'line\nbreak')).rejects.toBeInstanceOf(PolicyError);
    await expect(c.getInstalledMods(10, '   ')).rejects.toBeInstanceOf(PolicyError);
    await expect(c.getInstalledMods(10, 'x'.repeat(65))).rejects.toBeInstanceOf(PolicyError);
    await expect(c.getInstalledMods(10, 'Tuercas')).resolves.toMatchObject({ ok: true });
  });

  it('enforces the limit range at the client boundary too', async () => {
    const c = clientWithFetch(() => json({ mods: [] }));
    await expect(c.getInstalledMods(0)).rejects.toBeInstanceOf(PolicyError);
    await expect(c.getInstalledMods(21)).rejects.toBeInstanceOf(PolicyError);
    await expect(c.getInstalledMods(1.5)).rejects.toBeInstanceOf(PolicyError);
  });

  it('degrades to partial instead of failing the tool', async () => {
    const gone = clientWithFetch(() => json({ error: 'not found' }, 500));
    const unavailable = await gone.getInstalledMods(10);
    expect(unavailable.partial).toBe(true);
    expect(unavailable.code).toBe('MOD_LIST_UNAVAILABLE');
    expect(unavailable.total).toBe(0);
    expect(unavailable.mods).toEqual([]);

    const odd = clientWithFetch((url) => {
      if (url.endsWith('/api/mods/server-mods')) return json({ unexpected: true });
      return json({});
    });
    const shape = await odd.getInstalledMods(10);
    expect(shape.partial).toBe(true);
    expect(shape.code).toBe('MOD_LIST_SHAPE_UNKNOWN');
  });
});

describe('workshop and server health', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reads workshop health from every known shape', async () => {
    const mk = (payload: unknown) =>
      clientWithFetch((url) => {
        if (url.endsWith('/api/mods/workshop-status')) return json(payload);
        return json({});
      });
    expect(
      await mk({ reachable: true, lastChecked: '2026-09-11T00:00:00.000Z', pendingUpdates: 3 }).getWorkshopHealth(),
    ).toMatchObject({ reachable: true, lastChecked: '2026-09-11T00:00:00.000Z', pendingUpdates: 3 });
    expect((await mk({ status: 'ok' }).getWorkshopHealth()).reachable).toBe(true);
    expect((await mk({ online: true }).getWorkshopHealth()).reachable).toBe(true);
    expect((await mk({ status: 'down' }).getWorkshopHealth()).reachable).toBe(false);
  });

  it('never guesses workshop reachability', async () => {
    const gone = clientWithFetch(() => json({ error: 'nope' }, 500));
    const unreachable = await gone.getWorkshopHealth();
    expect(unreachable.reachable).toBe(false);
    expect(unreachable.partial).toBe(true);
    expect(unreachable.code).toBe('WORKSHOP_STATUS_UNAVAILABLE');

    const odd = clientWithFetch((url) => {
      if (url.endsWith('/api/mods/workshop-status')) return json({ foo: 1 });
      return json({});
    });
    const shape = await odd.getWorkshopHealth();
    expect(shape.reachable).toBe(false);
    expect(shape.code).toBe('WORKSHOP_SHAPE_UNKNOWN');
    expect(shape.missing).toEqual(['reachable']);
  });

  it('maps server health status strings and uptime', async () => {
    const mk = (payload: unknown) =>
      clientWithFetch((url) => {
        if (url.endsWith('/api/server/status')) return json(payload);
        return json({});
      });
    expect(await mk({ status: 'running', uptimeSeconds: 7200 }).getServerHealth()).toMatchObject({
      online: true,
      status: 'running',
      uptimeSeconds: 7200,
    });
    expect((await mk({ state: 'started' }).getServerHealth()).online).toBe(true);
    expect((await mk({ online: true }).getServerHealth()).online).toBe(true);
    expect((await mk({ status: 'stopped' }).getServerHealth()).online).toBe(false);
  });

  it('never invents liveness when the status endpoint fails or answers an unknown shape', async () => {
    const gone = clientWithFetch(() => json({ error: 'nope' }, 500));
    const unavailable = await gone.getServerHealth();
    expect(unavailable.online).toBe(false);
    expect(unavailable.status).toBe('unknown');
    expect(unavailable.uptimeSeconds).toBeNull();
    expect(unavailable.code).toBe('SERVER_STATUS_UNAVAILABLE');

    const odd = clientWithFetch((url) => {
      if (url.endsWith('/api/server/status')) return json({});
      return json({});
    });
    const shape = await odd.getServerHealth();
    expect(shape.online).toBe(false);
    expect(shape.partial).toBe(true);
    expect(shape.code).toBe('SERVER_STATUS_SHAPE_UNKNOWN');
  });
});

describe('community digest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('summarizes online players, the last 24h and the next maintenance', async () => {
    const now = Date.now();
    const hours = (n: number) => new Date(now - n * 3_600_000).toISOString();
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/players')) return json(['A', 'B', 'C']);
      if (url.includes('/api/players/activity')) {
        return json({
          logs: [
            { action: 'connect', logged_at: hours(1) },
            { action: 'death', logged_at: hours(2) },
            { action: 'connect', logged_at: hours(3) },
            { action: 'death', logged_at: hours(3) },
            { action: 'connect', logged_at: hours(49) }, // outside the 24h window
            { action: 'kick', logged_at: hours(4) }, // not community activity
          ],
        });
      }
      if (url.endsWith('/api/scheduler/status')) return json({ nextRun: { label: 'backup', at: '2026-09-12T04:00:00.000Z' } });
      return json({});
    });
    const r = await c.getCommunityDigest();
    expect(r.onlineCount).toBe(3);
    expect(r.onlineSample).toEqual(['A', 'B', 'C']);
    expect(r.last24h).toEqual({ connects: 2, deaths: 2 });
    expect(r.nextMaintenance).toEqual({ label: 'backup', at: '2026-09-12T04:00:00.000Z' });
    expect(r.partial).toBeUndefined();
  });

  it('caps the online sample at five names', async () => {
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/players')) return json(Array.from({ length: 9 }, (_, i) => `P${i}`));
      return json({});
    });
    const r = await c.getCommunityDigest();
    expect(r.onlineCount).toBe(9);
    expect(r.onlineSample).toHaveLength(5);
  });

  it('names the sources that failed instead of dropping them silently', async () => {
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/players')) return json(['A']);
      if (url.includes('/api/players/activity')) return json({ error: 'boom' }, 500);
      if (url.endsWith('/api/scheduler/status')) return json({});
      return json({});
    });
    const r = await c.getCommunityDigest();
    expect(r.onlineCount).toBe(1);
    expect(r.unavailable).toContain('activity');
    expect(r.last24h).toEqual({ connects: 0, deaths: 0 });
    expect(r.partial).toBe(true);
    expect(r.code).toBe('DIGEST_PARTIAL');
  });

  it('degrades to an empty summary when every source fails', async () => {
    const c = clientWithFetch(() => json({ error: 'down' }, 500));
    const r = await c.getCommunityDigest();
    expect(r.ok).toBe(true);
    expect(r.onlineCount).toBe(0);
    expect(r.nextMaintenance).toBeNull();
    expect(r.unavailable).toEqual(expect.arrayContaining(['players', 'activity', 'scheduler']));
    expect(r.code).toBe('DIGEST_UNAVAILABLE');
  });
});

describe('diagnostic reads are public queries', () => {
  it('are registered even with the optional feature flags off', () => {
    const tools = buildToolDefinitions({ enableModTools: false, enableBroadcastTool: false, serverName: 'ARKNO2' });
    const names = tools.map((t) => t.function.name);
    for (const n of DIAGNOSTIC_READS) {
      expect(names).toContain(n);
    }
  });

  it('are query-only, low risk and not admin-gated', () => {
    for (const n of DIAGNOSTIC_READS) {
      expect(ADMIN_ONLY_TOOLS.has(n)).toBe(false);
      expect(TOOL_METADATA[n].effect).toBe('query');
      expect(TOOL_METADATA[n].risk).toBe('low');
    }
  });

  it('validate installed mods args', () => {
    expect(() => validateToolArgs('get_installed_mods', {})).not.toThrow();
    expect(() => validateToolArgs('get_installed_mods', { limit: 20 })).not.toThrow();
    expect(() => validateToolArgs('get_installed_mods', { limit: 0 })).toThrow();
    expect(() => validateToolArgs('get_installed_mods', { limit: 21 })).toThrow();
    expect(() => validateToolArgs('get_installed_mods', { search: 'fuel' })).not.toThrow();
    expect(() => validateToolArgs('get_installed_mods', { search: '' })).toThrow();
    expect(() => validateToolArgs('get_installed_mods', { search: 'x'.repeat(65) })).toThrow();
    expect(() =>
      validateToolArgs('get_installed_mods', { server: 'otro' } as unknown as Record<string, unknown>),
    ).toThrow();
  });

  it('take no arguments at all', () => {
    for (const n of ['get_workshop_health', 'get_server_health', 'get_community_digest'] as const) {
      expect(() => validateToolArgs(n, {})).not.toThrow();
      expect(() => validateToolArgs(n, { limit: 5 } as unknown as Record<string, unknown>)).toThrow();
    }
  });

  it('run for any channel user and reject extra arguments', async () => {
    const panel = {
      getInstalledMods: async () => ({ ok: true, total: 272, count: 0, mods: [] }),
      getWorkshopHealth: async () => ({ ok: true, reachable: true, lastChecked: null }),
      getServerHealth: async () => ({ ok: true, online: true, status: 'running', uptimeSeconds: 10 }),
      getCommunityDigest: async () => ({
        ok: true,
        onlineCount: 1,
        onlineSample: ['A'],
        last24h: { connects: 0, deaths: 0 },
        nextMaintenance: null,
      }),
    } as unknown as PanelClient;
    const config = {
      adminUserId: 'admin-1',
      pzServerName: 'ARKNO2',
      mutationAllowedRoleIds: [],
    } as unknown as AppConfig;
    const ex = new ToolExecutor(panel, config);
    const ctx = { authorId: 'user-2', memberRoleIds: [], channelId: 'c' };

    for (const n of DIAGNOSTIC_READS) {
      const r = await ex.execute(n, {}, ctx);
      expect(r.denied ?? false).toBe(false);
      expect(r.ok).toBe(true);
      expect(r.status).toBe('success');
      expect(r.sideEffect).toBe(false);
    }

    const smuggled = await ex.execute('get_installed_mods', { server: 'otro' }, ctx);
    expect(smuggled.ok).toBe(false);
    expect(smuggled.code).toBe('INVALID_TOOL_ARGUMENTS');
    expect(smuggled.sideEffect).toBe(false);
  });
});