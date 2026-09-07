import type OpenAI from 'openai';
import { AppConfig } from '../config.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { buildToolDefinitions } from '../tools/definitions.js';
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

export class Orchestrator {
  constructor(
    private llm: OpenAI,
    private config: AppConfig,
    private executor: ToolExecutor,
    private store: ConversationStore,
  ) {}

  async handle(msg: IncomingMessage, hooks?: { onToolStart?: (tool: string) => Promise<void> }): Promise<string> {
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
    });

    const trustedBlock = [
      'Trusted Discord metadata:',
      `author_id=${msg.authorId}`,
      `is_xainner=${trustedXainner}`,
      `channel_id=${msg.channelId}`,
      `target_server=${this.config.pzServerName}`,
    ].join('\n');

    type ChatMsg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: unknown[] };
    const messages: ChatMsg[] = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n${trustedBlock}` },
      ...history.slice(-20).map((m) => ({
        role: m.role === 'tool' ? ('tool' as const) : m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      })),
    ];

    let toolCallsMade = 0;
    for (let round = 0; round < this.config.maxToolRounds; round++) {
      const res = await this.llm.chat.completions.create({
        model: this.config.openaiModel,
        temperature: this.config.openaiTemperature,
        max_tokens: this.config.openaiMaxTokens,
        messages: messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: tools as unknown as OpenAI.Chat.ChatCompletionTool[],
        tool_choice: 'auto',
      });
      const choice = res.choices[0]?.message;
      if (!choice) break;
      const calls = choice.tool_calls ?? [];
      if (calls.length === 0) {
        const text = choice.content?.trim() || '...';
        const clean = sanitizeDiscord(text);
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

    const res = await this.llm.chat.completions.create({
      model: this.config.openaiModel,
      temperature: this.config.openaiTemperature,
      max_tokens: this.config.openaiMaxTokens,
      messages: messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
    });
    const finalText = sanitizeDiscord(res.choices[0]?.message?.content?.trim() || 'Listo. Revise ARKNO2 y reporte lo confirmado por el panel.');
    await this.store.append(msg.channelId, { role: 'assistant', content: finalText, ts: Date.now() });
    return finalText;
  }
}
