import { describe, expect, it } from 'vitest';
import { shouldHandleMessage, splitDiscord } from '../src/discord/client.js';
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
    llmTimeoutMs: 30000,
    conversationDbPath: ':memory:',
  };
}

function msg(over: Record<string, unknown>): Record<string, unknown> {
  return { guild: { id: 'g' }, channelId: '100000000000000001', author: { bot: false }, content: 'hola', webhookId: null, ...over };
}

describe('discord routing', () => {
  it('ignores wrong channel, bots, webhooks, DMs, empty', () => {
    const c = cfg();
    expect(shouldHandleMessage(msg({ channelId: 'otro' }), c)).toBe(false);
    expect(shouldHandleMessage(msg({ author: { bot: true } }), c)).toBe(false);
    expect(shouldHandleMessage(msg({ webhookId: 'w' }), c)).toBe(false);
    expect(shouldHandleMessage(msg({ guild: null }), c)).toBe(false);
    expect(shouldHandleMessage(msg({ content: '   ' }), c)).toBe(false);
    expect(shouldHandleMessage(msg({}), c)).toBe(true);
  });

  it('splits long messages', () => {
    const parts = splitDiscord('a'.repeat(4000));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe('a'.repeat(4000));
  });
});
