import type OpenAI from 'openai';
import { AppConfig } from '../config.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { buildToolDefinitions, ToolDefinition } from '../tools/definitions.js';
import { ToolExecutor } from '../tools/executor.js';
import { isLifecycleTool } from '../tools/registry.js';
import { ConversationStore } from '../state/conversationStore.js';
import { isXainner } from '../security/policy.js';
import { sanitizeDiscord } from '../security/sanitize.js';
import { logger } from '../util/logger.js';

export interface IncomingMessage {
  channelId: string;
  authorId: string;
  authorLabel: string;
  memberRoleIds: string[];
  text: string;
}

const MUTATION_TOOLS = new Set([
  'save_world',
  'restart_server',
  'start_server',
  'stop_server',
  'broadcast_server_message',
  'cancel_pending_mod_restart',
  'check_mod_updates',
]);

interface ChatMsg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

const EMPTY_FALLBACK =
  'Se me fue la idea a mitad de frase. Preguntame de nuevo y te respondo bien.';
const ERROR_FALLBACK =
  'No logre comunicarme con el proveedor de IA justo ahora. Intentalo de nuevo en un momento.';

export class Orchestrator {
  constructor(
    private llm: OpenAI,
    private config: AppConfig,
    private executor: ToolExecutor,
    private store: ConversationStore,
  ) {}

  private async chat(messages: ChatMsg[], tools?: ToolDefinition[]): Promise<OpenAI.Chat.ChatCompletion> {
    return this.llm.chat.completions.create({
      model: this.config.openaiModel,
      temperature: this.config.openaiTemperature,
      max_tokens: this.config.openaiMaxTokens,
      messages: messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
      ...(tools ? { tools: tools as unknown as OpenAI.Chat.ChatCompletionTool[], tool_choice: 'auto' as const } : {}),
    }) as Promise<OpenAI.Chat.ChatCompletion>;
  }

  private async chatWithRetry(messages: ChatMsg[], tools?: ToolDefinition[]): Promise<OpenAI.Chat.ChatCompletion> {
    // The provider occasionally returns an empty message (no content, no tool
    // calls). That transient case deserves one retry before giving up.
    let res = await this.chat(messages, tools);
    if (this.isEmpty(res) && tools !== undefined) {
      logger.warn('llm_empty_response_retry', {});
      res = await this.chat(messages, tools);
    }
    return res;
  }

  private isEmpty(res: OpenAI.Chat.ChatCompletion): boolean {
    const msg = res.choices[0]?.message as { content?: string | null; tool_calls?: unknown[] } | undefined;
    return !!msg && (msg.content?.trim() ?? '') === '' && (msg.tool_calls ?? []).length === 0;
  }

  async handle(msg: IncomingMessage, hooks?: { onToolStart?: (tool: string) => Promise<void> }): Promise<string> {
    try {
      return await this.run(msg, hooks);
    } catch (err) {
      logger.error('llm_orchestration_failed', { error: err instanceof Error ? err.message : String(err) });
      const clean = sanitizeDiscord(ERROR_FALLBACK);
      await this.store.append(msg.channelId, { role: 'assistant', content: clean, ts: Date.now() }).catch(() => undefined);
      return clean;
    }
  }

  private async run(msg: IncomingMessage, hooks?: { onToolStart?: (tool: string) => Promise<void> }): Promise<string> {
    const trustedXainner = isXainner(msg.authorId, this.config.xainnerUserId);
    await this.store.append(msg.channelId, {
      role: 'user',
      content: `${msg.authorLabel}: ${msg.text}`,
      ts: Date.now(),
      authorId: msg.authorId,
    });

    const history = await this.store.recent(msg.channelId);
    const tools = buildToolDefinitions({
      enableModTools: this.config.enableModTools,
      enableBroadcastTool: this.config.enableBroadcastTool,
      serverName: this.config.pzServerName,
    });

    const trustedBlock = [
      'Trusted Discord metadata:',
      `author_id=${msg.authorId}`,
      `is_xainner=${trustedXainner}`,
      `channel_id=${msg.channelId}`,
      `target_server=${this.config.pzServerName}`,
    ].join('\n');

    const messages: ChatMsg[] = [
      { role: 'system', content: `${buildSystemPrompt(this.config.pzServerName)}\n\n${trustedBlock}` },
      ...history.slice(-20).map((m) => ({
        role: m.role === 'tool' ? ('tool' as const) : m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      })),
    ];

    let toolCallsMade = 0;
    for (let round = 0; round < this.config.maxToolRounds; round++) {
      const res = await this.chatWithRetry(messages, tools);
      const choice = res.choices[0]?.message;
      if (!choice) break;
      const calls = choice.tool_calls ?? [];
      if (calls.length === 0) {
        const raw = choice.content?.trim() || '';
        const clean = sanitizeDiscord(raw === '' ? EMPTY_FALLBACK : raw);
        await this.store.append(msg.channelId, { role: 'assistant', content: clean, ts: Date.now() });
        return clean;
      }
      messages.push({
        role: 'assistant',
        content: choice.content ?? '',
        tool_calls: calls as unknown[],
      } as ChatMsg);
      for (const call of calls) {
        if (toolCallsMade >= this.config.maxToolCallsPerMessage) break;
        toolCallsMade++;
        const name = (call as { function?: { name?: string } }).function?.name ?? '';
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse((call as { function?: { arguments?: string } }).function?.arguments ?? '{}') as Record<string, unknown>;
        } catch {
          args = {};
        }
        if (MUTATION_TOOLS.has(name) || isLifecycleTool(name)) {
          try {
            await hooks?.onToolStart?.(name);
          } catch {
            logger.warn('progress_update_failed', { tool: name });
          }
        }
        const result = await this.executor.execute(name, args, {
          authorId: msg.authorId,
          memberRoleIds: msg.memberRoleIds,
          channelId: msg.channelId,
        });
        messages.push({
          role: 'tool',
          content: JSON.stringify(result).slice(0, 3000),
          tool_call_id: (call as { id?: string }).id ?? '',
        });
      }
      if (toolCallsMade >= this.config.maxToolCallsPerMessage) break;
    }

    const res = await this.chatWithRetry(messages);
    const finalText = sanitizeDiscord(res.choices[0]?.message?.content?.trim() || EMPTY_FALLBACK);
    await this.store.append(msg.channelId, { role: 'assistant', content: finalText, ts: Date.now() });
    return finalText;
  }
}
