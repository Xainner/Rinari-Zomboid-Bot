import { ALLOWED_TOOL_NAMES } from './definitions.js';

export type ToolName =
  | 'get_server_status'
  | 'get_players'
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
}
