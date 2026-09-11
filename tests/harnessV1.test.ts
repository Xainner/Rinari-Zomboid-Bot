import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ToolExecutor } from '../src/tools/executor.js';
import { resetDomainLocksForTests, tryAcquireDomainLock, releaseDomainLock } from '../src/tools/concurrency.js';
import { projectToolResultForLlm, serializeForLlm } from '../src/tools/projector.js';
import { ChannelQueue } from '../src/discord/channelQueue.js';
import { PanelClient } from '../src/panel/client.js';
import { PanelAuth } from '../src/panel/auth.js';
import { PanelError } from '../src/panel/types.js';
import { Orchestrator } from '../src/llm/orchestrator.js';
import { createConversationStore } from '../src/state/conversationStore.js';
import type { AppConfig } from '../src/config.js';
import type { PanelClient as PanelClientType } from '../src/panel/client.js';

function baseConfig(): AppConfig {
  return {
    discordToken: 'x',
    discordClientId: '',
    discordGuildId: '',
    discordChannelId: '100000000000000001',
    adminUserId: 'admin-1',
    openaiBaseUrl: 'https://api.xainner.com/v1',
    openaiApiKey: 'k',
    openaiModel: 'qwen3.8-27b-uncensored',
    openaiTemperature: 0.8,
    openaiMaxTokens: 700,
    panelBaseUrl: 'http://127.0.0.1:3001',
    panelUsername: 'rinari_bot',
    panelPassword: 'x',
    pzServerName: 'ARKNO2',
    enableModTools: true,
    enableBroadcastTool: true,
    publicSave: true,
    publicRestart: true,
    nonAdminRestartMinWarning: 5,
    mutationAllowedRoleIds: [],
    logLevel: 'info',
    maxToolRounds: 4,
    maxToolCallsPerMessage: 3,
    panelTimeoutMs: 1000,
    llmTimeoutMs: 90000,
    conversationDbPath: ':memory:',
  } as AppConfig;
}

const CTX = (authorId = 'user-2') => ({ authorId, memberRoleIds: [] as string[], channelId: 'c' });

function panelMock(over: Record<string, unknown> = {}): PanelClientType {
  return {
    getArkno2Status: async () => ({ ok: true, server: 'ARKNO2' }),
    getPlayers: async () => ({ ok: true, server: 'ARKNO2', count: 0, players: [] }),
    ...over,
  } as unknown as PanelClientType;
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetDomainLocksForTests();
});

describe('harness v2 fase 1', () => {
  it('malformed args map to INVALID_TOOL_ARGUMENTS, not silent success', async () => {
    const ex = new ToolExecutor(panelMock(), baseConfig());
    const r = await ex.execute('restart_server', { warning_minutes: -1 }, CTX());
    expect(r.ok).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.code).toBe('INVALID_TOOL_ARGUMENTS');
    expect(r.retryable).toBe(false);
    expect(typeof r.actionId).toBe('string');
    expect(typeof r.durationMs).toBe('number');
  });

  it('unknown tool maps to UNKNOWN_TOOL', async () => {
    const ex = new ToolExecutor(panelMock(), baseConfig());
    const r = await ex.execute('shell', { command: 'rm -rf /' }, CTX());
    expect(r.ok).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.code).toBe('UNKNOWN_TOOL');
  });

  it('disabled mod tools are denied with a code', async () => {
    const cfg = { ...baseConfig(), enableModTools: false };
    const ex = new ToolExecutor(panelMock(), cfg);
    const r = await ex.execute('get_mod_status', {}, CTX());
    expect(r.denied).toBe(true);
    expect(r.status).toBe('denied');
    expect(r.code).toBe('FEATURE_DISABLED');
  });

  it('POST timeout surfaces as unknown_outcome (never auto-retried)', async () => {
    const panel = panelMock({
      assertArkno2Active: undefined,
      saveWorld: async () => {
        throw new PanelError('Panel POST /api/server/save timed out after send (outcome unknown)', 0, 'REQUEST_TIMEOUT_AFTER_SEND');
      },
    });
    // saveWorld asserts first; stub assert via real client shape
    (panel as unknown as Record<string, unknown>)['saveWorld'] = async () => {
      throw new PanelError('timed out after send', 0, 'REQUEST_TIMEOUT_AFTER_SEND');
    };
    const ex = new ToolExecutor(panel, baseConfig());
    const r = await ex.execute('save_world', {}, CTX('admin-1'));
    // save_world for admin path goes through runMutation directly; timeout mapping applies.
    // Public save path also maps. Either way it must be unknown_outcome, not success.
    expect(r.ok).toBe(false);
    expect(r.status).toBe('unknown_outcome');
    expect(r.code).toBe('REQUEST_TIMEOUT_AFTER_SEND');
    expect(r.sideEffect).toBe(true);
  });

  it('403 capability maps to failed PANEL_FORBIDDEN, not an empty list', async () => {
    const panel = panelMock({
      getPlayers: async () => {
        throw new PanelError('Forbidden', 403, 'FORBIDDEN');
      },
    });
    const ex = new ToolExecutor(panel, baseConfig());
    const r = await ex.execute('get_players', {}, CTX());
    expect(r.ok).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.code).toBe('PANEL_FORBIDDEN');
  });

  it('domain lock blocks a second mutation in the same domain', async () => {
    expect(tryAcquireDomainLock('ARKNO2', 'moderation')).toBe(true);
    const panel = panelMock({
      kickPlayer: async () => ({ ok: true, player: 'A' }),
    });
    const ex = new ToolExecutor(panel, baseConfig());
    const r = await ex.execute('kick_player', { player_name: 'A' }, { authorId: 'admin-1', memberRoleIds: [], channelId: 'c' });
    expect(r.denied).toBe(true);
    expect(r.code).toBe('DOMAIN_BUSY');
    releaseDomainLock('ARKNO2', 'moderation');
  });

  it('channel queue preserves FIFO order', async () => {
    const q = new ChannelQueue();
    const order: number[] = [];
    const mk = (n: number, ms: number) => () => new Promise<string>((res) => setTimeout(() => { order.push(n); res(`r${n}`); }, ms));
    const [a, b, c] = await Promise.all([q.run('ch', mk(1, 30)), q.run('ch', mk(2, 5)), q.run('ch', mk(3, 1))]);
    expect([a, b, c]).toEqual(['r1', 'r2', 'r3']);
    expect(order).toEqual([1, 2, 3]);
  });

  it('projector output always parses as JSON within the cap', () => {
    const big = { ok: true, server: 'ARKNO2', count: 200, players: Array.from({ length: 200 }, (_, i) => `Player${i}_with_a_long_name`) };
    const s = serializeForLlm(projectToolResultForLlm('get_players', big));
    expect(s.length).toBeLessThanOrEqual(3000);
    expect(() => JSON.parse(s)).not.toThrow();
  });

  it('orchestrator never coerces invalid tool JSON into executor call', async () => {
    const toolCall = { id: 'c1', type: 'function', function: { name: 'get_players', arguments: '{not-json' } };
    const create = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [toolCall] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { role: 'assistant', content: 'Listo, sin atajos raros.' } }] });
    const execute = vi.fn();
    const orch = new Orchestrator(
      { chat: { completions: { create } } } as unknown as import('openai').default,
      baseConfig(),
      { execute } as unknown as ToolExecutor,
      createConversationStore(),
    );
    const reply = await orch.handle({ channelId: '100000000000000001', authorId: '111', authorLabel: 't', memberRoleIds: [], text: 'hola' });
    expect(execute).not.toHaveBeenCalled();
    expect(reply).toBe('Listo, sin atajos raros.');
    // The tool message fed back to the model must carry the structured code.
    const toolLeg = create.mock.calls[1][0] as { messages: Array<{ role: string; content: string }> };
    const toolMsg = toolLeg.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('INVALID_TOOL_ARGUMENTS');
  });
});

describe('panel transport retry policy', () => {
  function clientWithFetch(handler: (url: string) => unknown, calls: string[]): PanelClient {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return handler(url) as Response;
    }));
    const auth = new PanelAuth({ baseUrl: 'http://x', username: 'u', password: 'p', timeoutMs: 1000 });
    (auth as unknown as { accessToken: string }).accessToken = 'tok';
    return new PanelClient({ baseUrl: 'http://x', serverName: 'ARKNO2', timeoutMs: 1000, auth });
  }

  function json(data: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => data, headers: new Headers() } as Response;
  }

  it('does not retry GET on contract errors (500)', async () => {
    const calls: string[] = [];
    const c = clientWithFetch(() => json({ error: 'bad' }, 500), calls);
    await expect(c.getPlayers()).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(1);
  });

  it('retries GET once on transient 503', async () => {
    const calls: string[] = [];
    let n = 0;
    const c = clientWithFetch(() => {
      n += 1;
      return n === 1 ? json({ error: 'busy' }, 503) : json({ players: [] });
    }, calls);
    const r = await c.getPlayers();
    expect(r.count).toBe(0);
    expect(calls).toHaveLength(2);
  });
});

describe('partial results instead of silent defaults', () => {
  function clientWithFetch(handler: (url: string) => unknown): PanelClient {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => handler(url) as Response));
    const auth = new PanelAuth({ baseUrl: 'http://x', username: 'u', password: 'p', timeoutMs: 1000 });
    (auth as unknown as { accessToken: string }).accessToken = 'tok';
    return new PanelClient({ baseUrl: 'http://x', serverName: 'ARKNO2', timeoutMs: 1000, auth });
  }

  function json(data: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => data, headers: new Headers() } as Response;
  }

  it('getModStatus marks partial when sub-endpoints fail', async () => {
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/mods/status')) return json({ error: 'x' }, 500);
      if (url.endsWith('/api/mods/tracked')) return json({ mods: [{ workshop_id: '1' }] });
      if (url.endsWith('/api/scheduler/status')) return json({ error: 'x' }, 500);
      return json({});
    });
    const r = await c.getModStatus();
    expect(r.partial).toBe(true);
    expect(r.code).toBe('MOD_STATUS_UNAVAILABLE');
    expect(r.missing).toContain('status');
    expect(r.tracked).toBe(1);
  });

  it('getArkno2Status marks consoleErrors unavailable instead of reporting 0', async () => {
    const c = clientWithFetch((url) => {
      if (url.endsWith('/api/servers/active/status')) return json({ host: 'running', rcon: 'connected' });
      if (url.includes('/api/server/console-log/error-count')) return json({ error: 'x' }, 500);
      return json({});
    });
    const r = await c.getArkno2Status();
    expect(r.consoleErrorsUnavailable).toBe(true);
    expect(r.partial).toBe(true);
    expect(r.code).toBe('CONSOLE_ERROR_COUNT_UNAVAILABLE');
  });
});
