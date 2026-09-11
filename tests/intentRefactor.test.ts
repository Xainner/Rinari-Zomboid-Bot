import { describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../src/llm/orchestrator.js';
import { buildSystemPrompt } from '../src/llm/systemPrompt.js';
import { createConversationStore } from '../src/state/conversationStore.js';
import { ALLOWED_TOOL_NAMES } from '../src/tools/definitions.js';
import { TOOL_METADATA, ADMIN_ONLY_TOOLS, type ToolName } from '../src/tools/registry.js';
import { ToolExecutor } from '../src/tools/executor.js';
import type { PanelClient } from '../src/panel/client.js';
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

describe('doc 02: intencion via assistant.content', () => {
  it('tool call con content envia una intencion sanitizada', async () => {
    const toolCall = { id: 'c1', type: 'function', function: { name: 'get_players', arguments: '{}' } };
    const create = vi
      .fn()
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Reviso quienes estan conectados.', tool_calls: [toolCall] }))
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Hay 2.' }));
    const execute = vi.fn().mockResolvedValue({ ok: true, data: { count: 2 } });
    const orch = new Orchestrator(
      mockLlm(create),
      cfg(),
      { execute } as unknown as ToolExecutor,
      createConversationStore(),
    );
    const onIntent = vi.fn().mockResolvedValue(undefined);
    const reply = await orch.handle(MSG, { onIntent });
    expect(reply).toBe('Hay 2.');
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith('Reviso quienes estan conectados.');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('tool call sin content ejecuta en silencio', async () => {
    const toolCall = { id: 'c1', type: 'function', function: { name: 'get_players', arguments: '{}' } };
    const create = vi
      .fn()
      .mockResolvedValueOnce(completion({ role: 'assistant', content: '', tool_calls: [toolCall] }))
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Hay 2.' }));
    const execute = vi.fn().mockResolvedValue({ ok: true, data: { count: 2 } });
    const orch = new Orchestrator(
      mockLlm(create),
      cfg(),
      { execute } as unknown as ToolExecutor,
      createConversationStore(),
    );
    const onIntent = vi.fn().mockResolvedValue(undefined);
    await orch.handle(MSG, { onIntent });
    expect(onIntent).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('multiples tools generan como maximo una intencion por ronda', async () => {
    const calls = ['get_players', 'get_server_status', 'get_next_maintenance'].map((name, i) => ({
      id: `c${i}`,
      type: 'function',
      function: { name, arguments: '{}' },
    }));
    const create = vi
      .fn()
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Reviso estado general.', tool_calls: calls }))
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Todo bien.' }));
    const execute = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const orch = new Orchestrator(
      mockLlm(create),
      cfg(),
      { execute } as unknown as ToolExecutor,
      createConversationStore(),
    );
    const onIntent = vi.fn().mockResolvedValue(undefined);
    await orch.handle(MSG, { onIntent });
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('intencion sanitiza mass mentions', async () => {
    const toolCall = { id: 'c1', type: 'function', function: { name: 'get_players', arguments: '{}' } };
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        completion({ role: 'assistant', content: 'Reviso @everyone y @here ahora', tool_calls: [toolCall] }),
      )
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Listo.' }));
    const execute = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const orch = new Orchestrator(
      mockLlm(create),
      cfg(),
      { execute } as unknown as ToolExecutor,
      createConversationStore(),
    );
    const onIntent = vi.fn().mockResolvedValue(undefined);
    await orch.handle(MSG, { onIntent });
    expect(onIntent).toHaveBeenCalledTimes(1);
    const sent = onIntent.mock.calls[0][0] as string;
    expect(sent).not.toContain('@everyone');
    expect(sent).not.toContain('@here');
  });
});

describe('doc 02: seguridad e intencion', () => {
  it('texto de intencion nunca salta policy (modelo dice ser admin, runtime rechaza)', async () => {
    const panel = {} as unknown as PanelClient;
    const ex = new ToolExecutor(panel, cfg());
    const r = await ex.execute(
      'ban_player',
      { player_name: 'Troll' },
      { authorId: '111', memberRoleIds: [], channelId: 'c' },
    );
    expect(r.ok).toBe(false);
    expect(r.denied).toBe(true);
    expect(r.status).toBe('denied');
    expect(r.code).toBe('ADMIN_ONLY');
    expect(r.reason).toBe('requester_is_not_admin');
  });

  it('denegacion llega al LLM como codigo estructurado, sin dialogo hardcoded', async () => {
    const toolCall = { id: 'c1', type: 'function', function: { name: 'ban_player', arguments: JSON.stringify({ player_name: 'Troll' }) } };
    const create = vi
      .fn()
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Voy a banearlo.', tool_calls: [toolCall] }))
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'No tengo permiso.' }));
    const denied = {
      ok: false,
      denied: true,
      status: 'denied',
      code: 'ADMIN_ONLY',
      reason: 'requester_is_not_admin',
      tool: 'ban_player',
      error: 'ADMIN_ONLY: requester_is_not_admin',
    };
    const execute = vi.fn().mockResolvedValue(denied);
    const orch = new Orchestrator(
      mockLlm(create),
      cfg(),
      { execute } as unknown as ToolExecutor,
      createConversationStore(),
    );
    await orch.handle(MSG, { onIntent: vi.fn().mockResolvedValue(undefined) });
    const toolLeg = create.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    // El segundo chat (final) recibe el tool result proyectado con el codigo.
    const secondCall = create.mock.calls[1][0] as { messages: Array<{ role: string; content: string }> };
    const toolMsg = secondCall.messages.find((m) => m.role === 'tool' || (m as { tool_calls?: unknown }).tool_calls !== undefined);
    void toolLeg;
    expect(JSON.stringify(secondCall.messages)).toContain('ADMIN_ONLY');
    expect(toolMsg ?? secondCall.messages).toBeDefined();
  });
});

describe('doc 02: metadata semantica sin frases', () => {
  it('cubre todas las tools con effect/risk/access/confirmation validos', () => {
    for (const name of ALLOWED_TOOL_NAMES) {
      const meta = TOOL_METADATA[name as ToolName];
      expect(meta, `missing metadata for ${name}`).toBeDefined();
      expect(['query', 'mutation', 'moderation']).toContain(meta.effect);
      expect(['low', 'medium', 'high']).toContain(meta.risk);
      expect(['public', 'privileged', 'admin']).toContain(meta.access);
      expect(['none', 'required']).toContain(meta.confirmation);
    }
  });

  it('moderacion es high/admin/required, lecturas publicas son low/public', () => {
    for (const n of ['kick_player', 'ban_player', 'unban_player', 'teleport_player', 'give_item', 'set_godmode']) {
      expect(ADMIN_ONLY_TOOLS.has(n)).toBe(true);
      const meta = TOOL_METADATA[n as ToolName];
      expect(meta.effect).toBe('moderation');
      expect(meta.risk).toBe('high');
      expect(meta.access).toBe('admin');
      expect(meta.confirmation).toBe('required');
    }
    expect(TOOL_METADATA['get_players'].access).toBe('public');
    expect(TOOL_METADATA['get_players'].risk).toBe('low');
  });
});

describe('doc 02: system prompt con regla de intencion', () => {
  it('incluye la regla MAY/intent y no promete progreso hardcoded del runtime', () => {
    const prompt = buildSystemPrompt('ARKNO2', '100000000000000002');
    expect(prompt).toContain('content accompanying the native tool_calls');
    expect(prompt).toContain('content may be empty');
    expect(prompt).not.toContain('The runtime may already send the pre-action progress update');
  });
});
