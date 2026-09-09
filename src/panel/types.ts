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

export interface ModStatusResult {
  ok: boolean;
  server: string;
  summary: string;
  pendingRestart: boolean;
  tracked: number;
  updatesAvailable: number;
  raw?: unknown;
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
