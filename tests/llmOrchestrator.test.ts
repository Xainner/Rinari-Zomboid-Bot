import { describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../src/llm/orchestrator.js';
import { createConversationStore } from '../src/state/conversationStore.js';
import type { AppConfig } from '../src/config.js';

function cfg(): AppConfig {
  return {
    discordToken: 'x',
    discordClientId: '',
    discordGuildId: '',
    discordChannelId: '100000000000000001',
    adminUserId: '100000000000000002',
    openaiBaseUrl: 'https://api.xainner.com/v1',
    openaiApiKey: 'x',
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
    panelTimeoutMs: 10000,
    llmTimeoutMs: 90000,
    conversationDbPath: ':memory:',
  };
}

function completion(message: unknown): unknown {
  return { choices: [{ message, finish_reason: 'stop' }] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockLlm(impl: (...args: any[]) => Promise<unknown>): any {
  return { chat: { completions: { create: vi.fn(impl) } } };
}

const MSG = { channelId: '100000000000000001', authorId: '111', authorLabel: 'tester', memberRoleIds: [], text: 'hola' };

describe('orchestrator resilience', () => {
  it('retries once on empty content with no tool calls', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(completion({ role: 'assistant', content: '', tool_calls: [] }))
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Hola, todo bien.' }));
    const orch = new Orchestrator(
      mockLlm(create),
      cfg(),
      { execute: vi.fn() } as unknown as import('../src/tools/executor.js').ToolExecutor,
      createConversationStore(),
    );
    const reply = await orch.handle(MSG);
    expect(reply).toBe('Hola, todo bien.');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('never replies with a bare placeholder when the model stays empty', async () => {
    const create = vi.fn().mockResolvedValue(completion({ role: 'assistant', content: '  ', tool_calls: [] }));
    const orch = new Orchestrator(
      mockLlm(create),
      cfg(),
      { execute: vi.fn() } as unknown as import('../src/tools/executor.js').ToolExecutor,
      createConversationStore(),
    );
    const reply = await orch.handle(MSG);
    expect(reply).not.toBe('...');
    expect(reply.length).toBeGreaterThan(10);
  });

  it('replies with an honest message when the provider throws', async () => {
    const create = vi.fn().mockRejectedValue(new Error('timeout'));
    const orch = new Orchestrator(
      mockLlm(create),
      cfg(),
      { execute: vi.fn() } as unknown as import('../src/tools/executor.js').ToolExecutor,
      createConversationStore(),
    );
    const reply = await orch.handle(MSG);
    expect(reply.length).toBeGreaterThan(10);
    expect(reply).not.toBe('...');
  });

  it('still executes a tool call round trip', async () => {
    const toolCall = { id: 'call1', type: 'function', function: { name: 'get_players', arguments: '{}' } };
    const create = vi
      .fn()
      .mockResolvedValueOnce(completion({ role: 'assistant', content: '', tool_calls: [toolCall] }))
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Hay 2 jugadores.' }));
    const execute = vi.fn().mockResolvedValue({ ok: true, data: { count: 2 } });
    const orch = new Orchestrator(
      mockLlm(create),
      cfg(),
      { execute } as unknown as import('../src/tools/executor.js').ToolExecutor,
      createConversationStore(),
    );
    const reply = await orch.handle(MSG);
    expect(reply).toBe('Hay 2 jugadores.');
    expect(execute).toHaveBeenCalledWith('get_players', {}, expect.objectContaining({ authorId: '111' }));
  });

  it('blocks hallucinated <tool_call> text and retries instead of leaking it', async () => {
    const leak = '<tool_call>\n<function=list_mod_updates>\n</function>\n</call>';
    const create = vi
      .fn()
      .mockResolvedValueOnce(completion({ role: 'assistant', content: leak }))
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Todo al día, sin updates.' }));
    const execute = vi.fn();
    const store = createConversationStore();
    const orch = new Orchestrator(
      mockLlm(create),
      cfg(),
      { execute } as unknown as import('../src/tools/executor.js').ToolExecutor,
      store,
    );
    const reply = await orch.handle(MSG);
    expect(reply).toBe('Todo al día, sin updates.');
    expect(execute).not.toHaveBeenCalled();
    const recent = await store.recent(MSG.channelId);
    expect(recent.some((m) => m.content.includes('tool_call'))).toBe(false);
  });

  it('falls back honestly when the model only emits pseudo tool calls', async () => {
    const leak = '<tool_call>\n<function=get_console_logs>\n</function>\n</call>';
    const create = vi.fn().mockResolvedValue(completion({ role: 'assistant', content: leak }));
    const orch = new Orchestrator(
      mockLlm(create),
      cfg(),
      { execute: vi.fn() } as unknown as import('../src/tools/executor.js').ToolExecutor,
      createConversationStore(),
    );
    const reply = await orch.handle(MSG);
    expect(reply).not.toContain('tool_call');
    expect(reply).not.toContain('get_console_logs');
    expect(reply.length).toBeGreaterThan(10);
  });
});
