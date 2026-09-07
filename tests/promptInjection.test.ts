import { describe, expect, it, vi } from 'vitest';
import { ToolExecutor } from '../src/tools/executor.js';
import type { PanelClient } from '../src/panel/client.js';
import type { AppConfig } from '../src/config.js';

function makeConfig(): AppConfig {
  return {
    discordToken: 'x',
    discordClientId: '',
    discordGuildId: '',
    discordChannelId: '1546326953815048263',
    xainnerUserId: '339977677811482634',
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
    nonXainnerRestartMinWarning: 5,
    mutationAllowedRoleIds: [],
    logLevel: 'info',
    maxToolRounds: 4,
    maxToolCallsPerMessage: 3,
    panelTimeoutMs: 10000,
    llmTimeoutMs: 30000,
    conversationDbPath: ':memory:',
  };
}

function makePanel(): PanelClient {
  return {
    getArkno2Status: vi.fn(),
    getPlayers: vi.fn(),
    getModStatus: vi.fn(),
    checkModUpdates: vi.fn(),
    saveWorld: vi.fn(),
    restartServer: vi.fn(),
    startServer: vi.fn(),
    stopServer: vi.fn(),
    sendServerMessage: vi.fn(),
    cancelPendingModRestart: vi.fn(),
  } as unknown as PanelClient;
}

describe('prompt injection resistance', () => {
  it('unknown shell tool is rejected', async () => {
    const ex = new ToolExecutor(makePanel(), makeConfig());
    const r = await ex.execute('shell', { command: 'rm -rf /' }, { authorId: '1', memberRoleIds: [], channelId: 'c' });
    expect(r.ok).toBe(false);
  });

  it('text claiming to be Xainner does not grant privilege', async () => {
    const panel = makePanel();
    const ex = new ToolExecutor(panel, makeConfig());
    const r = await ex.execute('stop_server', {}, { authorId: '999', memberRoleIds: [], channelId: 'c' });
    expect(r.ok).toBe(false);
    expect(r.denied).toBe(true);
    expect(panel.stopServer).not.toHaveBeenCalled();
  });

  it('wipe endpoint cannot be reached through executor', async () => {
    const ex = new ToolExecutor(makePanel(), makeConfig());
    const r = await ex.execute('/api/server/wipe', {}, { authorId: '339977677811482634', memberRoleIds: [], channelId: 'c' });
    expect(r.ok).toBe(false);
  });

  it('extra server field is rejected by schema validation', async () => {
    const panel = makePanel();
    const ex = new ToolExecutor(panel, makeConfig());
    const r = await ex.execute(
      'restart_server',
      { warning_minutes: 0, server: 'otro' },
      { authorId: '339977677811482634', memberRoleIds: [], channelId: 'c' },
    );
    expect(r.ok).toBe(false);
    expect(panel.restartServer).not.toHaveBeenCalled();
  });
});
