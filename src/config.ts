import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v.trim();
}

function optional(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function bool(name: string, fallback: boolean): boolean {
  const raw = optional(name, '');
  if (raw === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

function int(name: string, fallback: number): number {
  const raw = optional(name, '');
  if (raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer env var: ${name}=${raw}`);
  return n;
}

function float(name: string, fallback: number): number {
  const raw = optional(name, '');
  if (raw === '') return fallback;
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n)) throw new Error(`Invalid number env var: ${name}=${raw}`);
  return n;
}

export interface AppConfig {
  discordToken: string;
  discordClientId: string;
  discordGuildId: string;
  discordChannelId: string;
  xainnerUserId: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiTemperature: number;
  openaiMaxTokens: number;
  panelBaseUrl: string;
  panelUsername: string;
  panelPassword: string;
  pzServerName: string;
  enableModTools: boolean;
  enableBroadcastTool: boolean;
  publicSave: boolean;
  publicRestart: boolean;
  nonXainnerRestartMinWarning: number;
  mutationAllowedRoleIds: string[];
  logLevel: string;
  maxToolRounds: number;
  maxToolCallsPerMessage: number;
  panelTimeoutMs: number;
  llmTimeoutMs: number;
  conversationDbPath: string;
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  cached = {
    discordToken: required('DISCORD_TOKEN'),
    discordClientId: optional('DISCORD_CLIENT_ID'),
    discordGuildId: optional('DISCORD_GUILD_ID'),
    discordChannelId: optional('DISCORD_CHANNEL_ID', '1546326953815048263'),
    xainnerUserId: optional('XAINNER_USER_ID', '339977677811482634'),
    openaiBaseUrl: required('OPENAI_BASE_URL'),
    openaiApiKey: required('OPENAI_API_KEY'),
    openaiModel: required('OPENAI_MODEL'),
    openaiTemperature: float('OPENAI_TEMPERATURE', 0.8),
    openaiMaxTokens: int('OPENAI_MAX_TOKENS', 700),
    panelBaseUrl: optional('PANEL_BASE_URL', 'http://192.168.0.3:17050').replace(/\/$/, ''),
    panelUsername: required('PANEL_USERNAME'),
    panelPassword: required('PANEL_PASSWORD'),
    pzServerName: optional('PZ_SERVER_NAME', 'ARKNO2'),
    enableModTools: bool('ENABLE_MOD_TOOLS', false),
    enableBroadcastTool: bool('ENABLE_BROADCAST_TOOL', false),
    publicSave: bool('PUBLIC_SAVE', true),
    publicRestart: bool('PUBLIC_RESTART', true),
    nonXainnerRestartMinWarning: int('NON_XAINNER_RESTART_MIN_WARNING', 5),
    mutationAllowedRoleIds: optional('MUTATION_ALLOWED_ROLE_IDS')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    logLevel: optional('LOG_LEVEL', 'info'),
    maxToolRounds: int('MAX_TOOL_ROUNDS', 4),
    maxToolCallsPerMessage: int('MAX_TOOL_CALLS_PER_MESSAGE', 3),
    panelTimeoutMs: int('PANEL_TIMEOUT_MS', 10000),
    llmTimeoutMs: int('LLM_TIMEOUT_MS', 30000),
    conversationDbPath: optional('CONVERSATION_DB_PATH', './data/conversations.sqlite'),
  };
  if (cached.nonXainnerRestartMinWarning < 0 || cached.nonXainnerRestartMinWarning > 60) {
    throw new Error('NON_XAINNER_RESTART_MIN_WARNING must be in range 0..60');
  }
  return cached;
}

export function resetConfigForTests(): void {
  cached = null;
}
