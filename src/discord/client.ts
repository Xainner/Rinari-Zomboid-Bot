import { Client, Events, GatewayIntentBits, Message, Partials } from 'discord.js';
import { AppConfig } from '../config.js';
import { Orchestrator } from '../llm/orchestrator.js';
import { sharedChannelQueue } from './channelQueue.js';
import { checkRateLimit } from '../security/rateLimit.js';
import { sanitizeDiscord } from '../security/sanitize.js';
import { logger } from '../util/logger.js';

export function shouldHandleMessage(msg: Message, config: AppConfig): boolean {
  if (!msg.guild) return false;
  if (msg.channelId !== config.discordChannelId) return false;
  if (msg.author.bot) return false;
  if (msg.webhookId) return false;
  if (!msg.content || msg.content.trim().length === 0) return false;
  return true;
}

type SendableChannel = {
  sendTyping?: () => Promise<unknown>;
  send?: (opts: { content: string; allowedMentions: { parse: [] } }) => Promise<unknown>;
};

async function sendReply(msg: Message, content: string): Promise<void> {
  const opts = { content, allowedMentions: { parse: [] as [] } };
  try {
    await msg.reply(opts);
    return;
  } catch (err) {
    // Source message may be deleted; fall back to a plain channel message.
    logger.warn('discord_reply_failed', { error: err instanceof Error ? err.message : String(err) });
  }
  try {
    await (msg.channel as SendableChannel).send?.(opts);
  } catch (err) {
    logger.error('discord_send_failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export function createDiscordClient(config: AppConfig, orchestrator: Orchestrator): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel],
    allowedMentions: { parse: [] },
  });

  client.on(Events.ClientReady, () => {
    logger.info('discord_ready', { user: client.user?.tag });
  });

  client.on(Events.MessageCreate, async (msg: Message) => {
    let typingTimer: NodeJS.Timeout | null = null;
    try {
      if (!shouldHandleMessage(msg, config)) return;
      if (!checkRateLimit(msg.author.id)) return;
      const memberRoleIds = msg.member?.roles.cache.map((r) => r.id) ?? [];
      const ch = msg.channel as SendableChannel;
      const pokeTyping = (): void => {
        if (typeof ch.sendTyping === 'function') ch.sendTyping().catch(() => undefined);
      };
      pokeTyping();
      // Discord typing expires after ~10s; refresh while slow LLM legs run.
      typingTimer = setInterval(pokeTyping, 8000);
      // Harness v2 §8: FIFO per channel so histories and tool calls cannot interleave.
      const reply = await sharedChannelQueue().run(msg.channelId, () =>
        orchestrator.handle(
          {
            channelId: msg.channelId,
            authorId: msg.author.id,
            authorLabel: msg.author.username,
            memberRoleIds,
            text: msg.content.slice(0, 2000),
          },
          {
            onIntent: async (intent: string) => {
              await sendReply(msg, sanitizeDiscord(intent));
            },
          },
        ),
      );
      const chunks = splitDiscord(reply);
      for (const chunk of chunks) {
        await sendReply(msg, chunk);
      }
    } catch (err) {
      logger.error('discord_message_failed', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (typingTimer) clearInterval(typingTimer);
    }
  });

  return client;
}

export function splitDiscord(text: string, limit = 1900): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < 500) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}
