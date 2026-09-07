import { Client, Events, GatewayIntentBits, Message, Partials } from 'discord.js';
import { AppConfig } from '../config.js';
import { Orchestrator } from '../llm/orchestrator.js';
import { progressForTool } from './progressMessages.js';
import { isAdmin } from '../security/policy.js';
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
    try {
      if (!shouldHandleMessage(msg, config)) return;
      if (!checkRateLimit(msg.author.id)) return;
      const memberRoleIds = msg.member?.roles.cache.map((r) => r.id) ?? [];
      const adminUser = isAdmin(msg.author.id, config.adminUserId);
      const ch = msg.channel as { sendTyping?: () => Promise<unknown> };
      if (typeof ch.sendTyping === 'function') await ch.sendTyping().catch(() => undefined);
      const reply = await orchestrator.handle(
        {
          channelId: msg.channelId,
          authorId: msg.author.id,
          authorLabel: msg.author.username,
          memberRoleIds,
          text: msg.content.slice(0, 2000),
        },
        {
          onToolStart: async (tool: string) => {
            const progress = progressForTool(tool, adminUser, config.pzServerName);
            if (progress) {
              await msg.reply({ content: sanitizeDiscord(progress), allowedMentions: { parse: [] } }).catch(() => undefined);
            }
          },
        },
      );
      const chunks = splitDiscord(reply);
      for (const chunk of chunks) {
        await msg.reply({ content: chunk, allowedMentions: { parse: [] } }).catch(() => undefined);
      }
    } catch (err) {
      logger.error('discord_message_failed', { error: err instanceof Error ? err.message : String(err) });
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
