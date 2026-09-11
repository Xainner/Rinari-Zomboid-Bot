/**
 * Per-tool projector for the LLM (doc 01 section 19).
 *
 * Replaces JSON.stringify(result).slice(0, 3000), which can cut JSON
 * in half. Each projector returns a small, stable, JSON-serializable
 * object with only what the model needs to redact the reply.
 */
export function projectToolResultForLlm(toolName: string, result: unknown): unknown {
  const r = result as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return { ok: true, result };

  switch (toolName) {
    case 'get_server_status': {
      return {
        ok: r['ok'] ?? true,
        server: r['server'],
        host: r['host'],
        rcon: r['rcon'],
        panelBridge: r['panelBridge'],
        consoleErrors: r['consoleErrors'],
        ...(typeof r['consoleErrorsUnavailable'] !== 'undefined'
          ? { consoleErrorsUnavailable: r['consoleErrorsUnavailable'] }
          : {}),
        ...(typeof r['partial'] !== 'undefined' ? { partial: r['partial'], code: r['code'] } : {}),
      };
    }
    case 'get_players': {
      const players = Array.isArray(r['players']) ? (r['players'] as unknown[]).slice(0, 50) : [];
      return { ok: true, server: r['server'], count: r['count'] ?? players.length, players };
    }
    case 'get_player_hours': {
      if (r['scope'] === 'ranking') {
        const ranking = Array.isArray(r['ranking']) ? (r['ranking'] as unknown[]).slice(0, 10) : [];
        return { ok: true, server: r['server'], scope: 'ranking', tracked: r['tracked'], ranking };
      }
      return { ok: true, server: r['server'], scope: r['scope'], found: r['found'], entry: r['entry'] };
    }
    case 'get_player_activity':
    case 'get_death_ranking':
    case 'get_mod_updates_detail':
    case 'get_next_maintenance':
    case 'get_backups':
    case 'get_world_info':
    case 'get_recent_errors':
    case 'get_player_position':
    case 'get_mod_status':
    case 'check_mod_updates': {
      // These payloads are already small; cap arrays defensively.
      return capArrays(r, 50);
    }
    case 'save_world':
    case 'restart_server':
    case 'start_server':
    case 'stop_server':
    case 'broadcast_server_message':
    case 'cancel_pending_mod_restart':
    case 'kick_player':
    case 'ban_player':
    case 'unban_player':
    case 'teleport_player':
    case 'give_item':
    case 'set_godmode': {
      return { ok: r['ok'] ?? true, server: r['server'], ...(pickDefined(r, ['player', 'warningMinutes', 'via', 'warning'])) };
    }
    default:
      return capArrays(r, 20);
  }
}

function pickDefined(src: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return out;
}

function capArrays(src: Record<string, unknown>, max: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = Array.isArray(v) ? v.slice(0, max) : v;
  }
  return out;
}

/** Serialize a projected result without ever emitting half-cut JSON. */
export function serializeForLlm(projected: unknown, hardCap = 3000): string {
  const full = JSON.stringify(projected) ?? '{}';
  if (full.length <= hardCap) return full;
  // Shrink arrays progressively instead of slicing the string.
  const shrunk = JSON.parse(full) as Record<string, unknown>;
  for (const k of Object.keys(shrunk)) {
    if (Array.isArray(shrunk[k])) shrunk[k] = (shrunk[k] as unknown[]).slice(0, 10);
  }
  let out = JSON.stringify(shrunk) ?? '{}';
  if (out.length <= hardCap) return out;
  for (const k of Object.keys(shrunk)) {
    if (Array.isArray(shrunk[k])) shrunk[k] = (shrunk[k] as unknown[]).slice(0, 3);
  }
  out = JSON.stringify(shrunk) ?? '{}';
  if (out.length <= hardCap) return out;
  // Last resort: keep object keys but drop the largest array.
  let largest = '';
  let largestLen = 0;
  for (const [k, v] of Object.entries(shrunk)) {
    if (Array.isArray(v) && v.length > largestLen) {
      largest = k;
      largestLen = v.length;
    }
  }
  if (largest) {
    (shrunk as Record<string, unknown>)[largest] = `[truncated ${largestLen} items]`;
    out = JSON.stringify(shrunk) ?? '{}';
    if (out.length <= hardCap) return out;
  }
  // Truncate long string fields before giving up (e.g. console lines).
  for (const k of Object.keys(shrunk)) {
    const v = shrunk[k];
    if (typeof v === 'string' && v.length > 500) shrunk[k] = `${v.slice(0, 500)}...[truncated]`;
    if (Array.isArray(v)) shrunk[k] = `[truncated ${v.length} items]`;
  }
  out = JSON.stringify(shrunk) ?? '{}';
  if (out.length <= hardCap) return out;
  // Absolute fallback: always valid JSON, never a sliced object.
  const preview = JSON.stringify(shrunk).slice(0, Math.max(0, hardCap - 60));
  return JSON.stringify({ truncated: true, preview });
}
