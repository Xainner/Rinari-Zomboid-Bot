import { loadConfig } from './config.js';
import { PanelAuth } from './panel/auth.js';
import { PanelClient } from './panel/client.js';

async function main(): Promise<void> {
  const config = loadConfig();
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
  await auth.login();
  const { server } = await panel.getActiveServer();
  console.log(JSON.stringify({ activeServer: server?.serverName ?? null }));
  const status = await panel.getArkno2Status();
  console.log(JSON.stringify(status));
  const players = await panel.getPlayers();
  console.log(JSON.stringify(players));
  if (config.enableModTools) {
    const mods = await panel.getModStatus();
    console.log(JSON.stringify(mods));
  }
  console.log('PREFLIGHT OK (read-only, no mutations executed)');
}

main().catch((err) => {
  console.error(`PREFLIGHT FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
