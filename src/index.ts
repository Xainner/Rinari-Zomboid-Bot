import { loadConfig } from './config.js';
import { setLogLevel, logger } from './util/logger.js';
import { registerSecrets } from './security/sanitize.js';
import { PanelAuth } from './panel/auth.js';
import { PanelClient } from './panel/client.js';
import { createLlmClient } from './llm/client.js';
import { Orchestrator } from './llm/orchestrator.js';
import { createConversationStore } from './state/conversationStore.js';
import { ToolExecutor } from './tools/executor.js';
import { createDiscordClient } from './discord/client.js';

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  registerSecrets([config.discordToken, config.openaiApiKey, config.panelPassword]);

  const auth = new PanelAuth({
    baseUrl: config.panelBaseUrl,
    username: config.panelUsername,
    password: config.panelPassword,
    timeoutMs: config.panelTimeoutMs,
  });
  const panel = new PanelClient({
    baseUrl: config.panelBaseUrl,
    serverName: config.pzServerName,
    timeoutMs: config.panelTimeoutMs,
    auth,
  });
  const llm = createLlmClient(config);
  const store = createConversationStore(config.conversationDbPath);
  const executor = new ToolExecutor(panel, config);
  const orchestrator = new Orchestrator(llm, config, executor, store);

  const discord = createDiscordClient(config, orchestrator);
  await discord.login(config.discordToken);
  logger.info('startup', {
    server: config.pzServerName,
    channel: config.discordChannelId,
    modTools: config.enableModTools,
    broadcast: config.enableBroadcastTool,
  });
}

main().catch((err) => {
  logger.error('fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
