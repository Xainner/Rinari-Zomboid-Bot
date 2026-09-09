import { ALLOWED_TOOL_NAMES } from './definitions.js';

export type ToolName =
  | 'get_server_status'
  | 'get_players'
  | 'get_player_hours'
  | 'get_player_activity'
  | 'get_death_ranking'
  | 'get_mod_updates_detail'
  | 'get_next_maintenance'
  | 'get_backups'
  | 'get_world_info'
  | 'get_recent_errors'
  | 'get_player_position'
  | 'kick_player'
  | 'ban_player'
  | 'unban_player'
  | 'teleport_player'
  | 'give_item'
  | 'set_godmode'
  | 'get_mod_status'
  | 'check_mod_updates'
  | 'save_world'
  | 'restart_server'
  | 'start_server'
  | 'stop_server'
  | 'broadcast_server_message'
  | 'cancel_pending_mod_restart';

const LIFECYCLE_TOOLS: ReadonlySet<ToolName> = new Set(['start_server', 'stop_server', 'restart_server']);

let lifecycleLocked = false;

export function isLifecycleTool(name: string): boolean {
  return LIFECYCLE_TOOLS.has(name as ToolName);
}

export function tryAcquireLifecycleLock(): boolean {
  if (lifecycleLocked) return false;
  lifecycleLocked = true;
  return true;
}

export function releaseLifecycleLock(): void {
  lifecycleLocked = false;
}

export function resetLifecycleLockForTests(): void {
  lifecycleLocked = false;
}

export function assertKnownTool(name: string): asserts name is ToolName {
  if (!ALLOWED_TOOL_NAMES.has(name)) {
    throw new Error(`UNKNOWN_TOOL: ${name}`);
  }
}

export function validateToolArgs(name: ToolName, args: Record<string, unknown>): void {
  const allowedByTool: Record<ToolName, string[]> = {
    get_server_status: [],
    get_players: [],
    get_player_hours: ['player_name'],
    get_player_activity: ['player_name', 'action', 'limit'],
    get_death_ranking: ['limit'],
    get_mod_updates_detail: [],
    get_next_maintenance: [],
    get_backups: ['limit'],
    get_world_info: [],
    get_recent_errors: ['limit'],
    get_player_position: ['player_name'],
    kick_player: ['player_name', 'reason'],
    ban_player: ['player_name', 'ban_ip', 'reason'],
    unban_player: ['player_name'],
    teleport_player: ['player_name', 'target_player', 'x', 'y', 'z'],
    give_item: ['player_name', 'item', 'count'],
    set_godmode: ['player_name', 'enabled'],
    get_mod_status: [],
    check_mod_updates: [],
    save_world: [],
    restart_server: ['warning_minutes', 'reason'],
    start_server: [],
    stop_server: [],
    broadcast_server_message: ['message'],
    cancel_pending_mod_restart: [],
  };
  const allowed = allowedByTool[name];
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) {
      throw new Error(`Invalid argument: ${key} is not allowed for ${name}`);
    }
  }
  if (name === 'restart_server') {
    const w = args['warning_minutes'];
    if (!Number.isInteger(w) || (w as number) < 0 || (w as number) > 60) {
      throw new Error('warning_minutes must be an integer in range 0..60');
    }
    if (args['reason'] !== undefined && typeof args['reason'] !== 'string') {
      throw new Error('reason must be a string');
    }
    if (typeof args['reason'] === 'string' && (args['reason'] as string).length > 240) {
      throw new Error('reason must be at most 240 characters');
    }
  }
  if (name === 'broadcast_server_message') {
    const m = args['message'];
    if (typeof m !== 'string' || m.length < 1 || m.length > 300) {
      throw new Error('message must be a string of length 1..300');
    }
  }
  if (name === 'get_player_hours' || name === 'get_player_activity') {
    const p = args['player_name'];
    if (p !== undefined && (typeof p !== 'string' || p.trim().length < 1 || p.length > 64)) {
      throw new Error('player_name must be a string of length 1..64');
    }
  }
  if (name === 'get_player_activity') {
    const a = args['action'];
    if (a !== undefined && (typeof a !== 'string' || !['connect', 'disconnect', 'death'].includes(a))) {
      throw new Error('action must be one of: connect, disconnect, death');
    }
    const l = args['limit'];
    if (l !== undefined && (!Number.isInteger(l) || (l as number) < 1 || (l as number) > 20)) {
      throw new Error('limit must be an integer in range 1..20');
    }
  }
  if (name === 'get_death_ranking' || name === 'get_backups') {
    const l = args['limit'];
    if (l !== undefined && (!Number.isInteger(l) || (l as number) < 1 || (l as number) > 10)) {
      throw new Error('limit must be an integer in range 1..10');
    }
  }
  if (name === 'get_recent_errors') {
    const l = args['limit'];
    if (l !== undefined && (!Number.isInteger(l) || (l as number) < 1 || (l as number) > 20)) {
      throw new Error('limit must be an integer in range 1..20');
    }
  }
  if (name === 'get_player_position') {
    const p = args['player_name'];
    if (p !== undefined && (typeof p !== 'string' || p.trim().length < 1 || p.length > 64)) {
      throw new Error('player_name must be a string of length 1..64');
    }
  }
  if (name === 'kick_player' || name === 'ban_player' || name === 'unban_player' || name === 'set_godmode') {
    const p = args['player_name'];
    if (typeof p !== 'string' || p.trim().length < 1 || p.length > 64) {
      throw new Error('player_name is required (string, 1..64 chars)');
    }
  }
  if (name === 'kick_player' || name === 'ban_player') {
    const r = args['reason'];
    if (r !== undefined && (typeof r !== 'string' || r.length > 256)) {
      throw new Error('reason must be a string of at most 256 characters');
    }
  }
  if (name === 'ban_player') {
    const b = args['ban_ip'];
    if (b !== undefined && typeof b !== 'boolean') throw new Error('ban_ip must be a boolean');
  }
  if (name === 'teleport_player') {
    for (const k of ['x', 'y', 'z'] as const) {
      const v = args[k];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) {
        throw new Error(`${k} must be a number`);
      }
    }
    const t = args['target_player'];
    if (t !== undefined && (typeof t !== 'string' || (t as string).trim().length < 1 || (t as string).length > 64)) {
      throw new Error('target_player must be a string of length 1..64');
    }
  }
  if (name === 'give_item') {
    const i = args['item'];
    if (typeof i !== 'string' || (i as string).length < 1 || (i as string).length > 64) {
      throw new Error('item is required (string like Base.Axe, 1..64 chars)');
    }
    const c = args['count'];
    if (c !== undefined && (!Number.isInteger(c) || (c as number) < 1 || (c as number) > 100)) {
      throw new Error('count must be an integer in range 1..100');
    }
  }
  if (name === 'set_godmode') {
    if (typeof args['enabled'] !== 'boolean') throw new Error('enabled is required (boolean)');
  }
}

/**
 * Tools restricted to the admin user only (no role bypass).
 * Reads here are admin-only data; moderation tools have real consequences.
 */
export const ADMIN_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'get_recent_errors',
  'get_player_position',
  'kick_player',
  'ban_player',
  'unban_player',
  'teleport_player',
  'give_item',
  'set_godmode',
]);
