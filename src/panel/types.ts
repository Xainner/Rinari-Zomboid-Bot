export interface ActiveServer {
  id?: string;
  serverName: string;
  isActive?: boolean;
  raw: unknown;
}

export interface Arkno2Status {
  ok: boolean;
  server: string;
  host: string;
  rcon: string;
  panelBridge: string;
  consoleErrors: number;
  /** True when the error-count endpoint failed and consoleErrors is a fallback. */
  consoleErrorsUnavailable?: boolean;
  /** Harness v2 partial marker (doc 01 section 7). Never silently default. */
  partial?: boolean;
  code?: string;
}

export interface PlayersResult {
  ok: boolean;
  server: string;
  count: number;
  players: string[];
}

export interface PlayerHoursEntry {
  player: string;
  /** Hours played, rounded to 1 decimal. Includes the live ongoing session. */
  hours: number;
  sessions: number;
  online: boolean;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface PlayerHoursResult {
  ok: boolean;
  server: string;
  scope: 'ranking' | 'player';
  /** Total players tracked (ranking scope only). */
  tracked?: number;
  ranking?: PlayerHoursEntry[];
  entry?: PlayerHoursEntry;
  found?: boolean;
}

export interface PlayerActivityEvent {
  player: string;
  action: string;
  details: string;
  at: string;
}

export interface PlayerActivityResult {
  ok: boolean;
  server: string;
  count: number;
  events: PlayerActivityEvent[];
}

export interface DeathRankingEntry {
  player: string;
  deaths: number;
}

export interface DeathRankingResult {
  ok: boolean;
  server: string;
  /** Death events seen in the scan window. */
  windowDeaths: number;
  ranking: DeathRankingEntry[];
}

export interface ModUpdateEntry {
  workshop_id: string;
  name: string;
}

export interface ModUpdatesDetailResult {
  ok: boolean;
  server: string;
  count: number;
  updates: ModUpdateEntry[];
}

export interface NextMaintenanceResult {
  ok: boolean;
  server: string;
  next: { label: string; at: string } | null;
  autoRestart: boolean;
  backupScheduled: boolean;
}

export interface BackupSummary {
  name: string;
  size: number;
  created: string;
}

export interface BackupsResult {
  ok: boolean;
  server: string;
  enabled: boolean;
  schedule: string | null;
  backupCount: number;
  backupInProgress: boolean;
  lastBackup: BackupSummary | null;
  recent: BackupSummary[];
}

export interface WorldInfoResult {
  ok: boolean;
  server: string;
  available: boolean;
  /** Which bridge sections failed (partial result, doc 01 section 7). */
  unavailable?: string[];
  partial?: boolean;
  code?: string;
  time?: { year: number; month: number; day: number; hour: number; minute: number; nightsSurvived: number };
  weather?: { temperature: number; raining: boolean; snowing: boolean; storm: boolean; fog: number; clouds: number };
  zombies?: number;
  map?: string;
}

export interface RecentErrorsResult {
  ok: boolean;
  server: string;
  count: number;
  lines: string[];
}

export interface PlayerPosition {
  player: string;
  x: number;
  y: number;
  z: number;
  health: number;
}

export interface PlayerPositionResult {
  ok: boolean;
  server: string;
  available: boolean;
  scope?: 'all' | 'player';
  count?: number;
  positions?: PlayerPosition[];
  entry?: PlayerPosition;
  found?: boolean;
}

export interface PlayerModerationResult {
  ok: boolean;
  server: string;
  player: string;
  /** How the panel executed it (e.g. bridge vs rcon), when reported. */
  via?: string;
  /** Panel-side caveat (e.g. RCON targeting limits), when reported. */
  warning?: string;
}

export interface ModStatusResult {
  ok: boolean;
  server: string;
  summary: string;
  pendingRestart: boolean;
  tracked: number;
  updatesAvailable: number;
  raw?: unknown;
  /** Harness v2: true when one or more sub-endpoints failed. */
  partial?: boolean;
  code?: string;
  missing?: string[];
}

export class PanelError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'PanelError';
    this.status = status;
    this.code = code;
  }
}

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}
