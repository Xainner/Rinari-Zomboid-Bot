import { describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../src/llm/orchestrator.js';
import { createConversationStore } from '../src/state/conversationStore.js';
import type { AppConfig } from '../src/config.js';

function cfg(): AppConfig {
  return {
    discordToken: 'x',
    discordClientId: '',
    discordGuildId: '',
    discordChannelId: '1546326953815048263',
    adminUserId: '339977677811482634',
    openaiBaseUrl: 'https://api.xainner.com/v1',
    openaiApiKey: 'x',
    openaiModel: 'qwen3.8-27b-uncensored',
    openaiTemperature: 0.8,
    openaiMaxTokens: 700,
    panelBaseUrl: 'http://192.168.0.3:17050',
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

const MSG = { channelId: '1546326953815048263', authorId: '111', authorLabel: 'tester', memberRoleIds: [], text: 'hola' };

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
});
