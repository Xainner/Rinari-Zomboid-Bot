/**
 * Concurrency domains (doc 01 section 8).
 *
 * The old global lifecycle boolean does not scale: a mod check should
 * not block a player kick. Each tool declares a domain; locks are
 * per server + domain.
 */
import type { ToolName } from './registry.js';

const locks = new Map<string, boolean>();

export function concurrencyDomainForTool(tool: ToolName): string {
  switch (tool) {
    case 'start_server':
    case 'stop_server':
    case 'restart_server':
      return 'lifecycle';
    case 'get_mod_status':
    case 'check_mod_updates':
    case 'cancel_pending_mod_restart':
    case 'get_mod_updates_detail':
      return 'mods';
    case 'get_backups':
      return 'backups';
    case 'kick_player':
    case 'ban_player':
    case 'unban_player':
    case 'teleport_player':
    case 'give_item':
    case 'set_godmode':
      return 'moderation';
    case 'save_world':
    case 'broadcast_server_message':
      return 'world';
    default:
      return 'reads';
  }
}

/** Domains that must be mutually exclusive (mutations). Reads never lock. */
const LOCKED_DOMAINS: ReadonlySet<string> = new Set([
  'lifecycle',
  'mods',
  // 'backups' reserved for Fase 5 (create/restore): get_backups is read-only
  // and never acquires a lock, so listing it here would be dead config.
  'moderation',
  'world',
]);

export function domainNeedsLock(domain: string): boolean {
  return LOCKED_DOMAINS.has(domain);
}

function key(server: string, domain: string): string {
  return `${server}:${domain}`;
}

export function tryAcquireDomainLock(server: string, domain: string): boolean {
  if (!domainNeedsLock(domain)) return true;
  const k = key(server, domain);
  if (locks.get(k)) return false;
  locks.set(k, true);
  return true;
}

export function releaseDomainLock(server: string, domain: string): void {
  if (!domainNeedsLock(domain)) return;
  locks.delete(key(server, domain));
}

export function resetDomainLocksForTests(): void {
  locks.clear();
}
