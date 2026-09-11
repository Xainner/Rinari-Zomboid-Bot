import { describe, expect, it } from 'vitest';
import { ToolExecutor } from '../src/tools/executor.js';
import type { PanelClient } from '../src/panel/client.js';
import type { AppConfig } from '../src/config.js';

function executor(): ToolExecutor {
  const panel = {
    getRecentErrors: async () => ({ ok: true, lines: [] }),
    getPlayerPosition: async () => ({ ok: true, available: true, scope: 'all', count: 0, positions: [] }),
    getPlayers: async () => ({ ok: true, players: [] }),
  } as unknown as PanelClient;
  const config = {
    adminUserId: 'admin-1',
    pzServerName: 'ARKNO2',
    mutationAllowedRoleIds: ['role-9'],
    enableModTools: true,
    enableBroadcastTool: true,
    publicSave: true,
    publicRestart: true,
    nonAdminRestartMinWarning: 5,
  } as unknown as AppConfig;
  return new ToolExecutor(panel, config);
}

const CTX = (authorId: string, memberRoleIds: string[] = []) => ({ authorId, memberRoleIds, channelId: 'c' });

describe('admin-only tools', () => {
  it('denies get_recent_errors to non-admin, even with role', async () => {
    const ex = executor();
    const plain = await ex.execute('get_recent_errors', {}, CTX('user-2'));
    expect(plain.denied).toBe(true);
    const withRole = await ex.execute('get_recent_errors', {}, CTX('user-2', ['role-9']));
    expect(withRole.denied).toBe(true);
  });

  it('denies get_player_position to non-admin', async () => {
    const ex = executor();
    const r = await ex.execute('get_player_position', {}, CTX('user-2'));
    expect(r.denied).toBe(true);
    expect(r.status).toBe('denied');
    expect(r.code).toBe('ADMIN_ONLY');
    expect(r.reason).toBe('requester_is_not_admin');
    // Doc 02 §10: runtime returns structured codes, never dialogue for Discord.
    expect(r.error).not.toMatch(/Xainner/);
    expect(r.error).toContain('ADMIN_ONLY');
  });

  it('allows admin through', async () => {
    const ex = executor();
    expect((await ex.execute('get_recent_errors', {}, CTX('admin-1'))).ok).toBe(true);
    expect((await ex.execute('get_player_position', { player_name: 'A' }, CTX('admin-1'))).ok).toBe(true);
  });

  it('keeps public reads open', async () => {
    const ex = executor();
    expect((await ex.execute('get_players', {}, CTX('user-2'))).ok).toBe(true);
  });

  it('denies moderation to non-admin, even with role', async () => {
    const ex = executor();
    const cases: Array<[string, Record<string, unknown>]> = [
      ['kick_player', { player_name: 'A' }],
      ['ban_player', { player_name: 'A', ban_ip: false }],
      ['unban_player', { player_name: 'A' }],
      ['teleport_player', { player_name: 'A', target_player: 'B' }],
      ['give_item', { player_name: 'A', item: 'Base.Axe', count: 1 }],
      ['set_godmode', { player_name: 'A', enabled: true }],
    ];
    for (const [tool, args] of cases) {
      const denied = await ex.execute(tool, args, CTX('user-2', ['role-9']));
      expect(denied.denied).toBe(true);
    }
  });

  it('runs moderation for admin', async () => {
    const panel = {
      assertArkno2Active: async () => {},
      kickPlayer: async (player_name: string) => ({ ok: true, player: player_name }),
      banPlayer: async (player_name: string) => ({ ok: true, player: player_name }),
    } as unknown as PanelClient;
    const config = { adminUserId: 'admin-1', pzServerName: 'ARKNO2', mutationAllowedRoleIds: [] } as unknown as AppConfig;
    const ex = new ToolExecutor(panel, config);
    expect((await ex.execute('kick_player', { player_name: 'Troll' }, CTX('admin-1'))).ok).toBe(true);
    expect((await ex.execute('ban_player', { player_name: 'Troll' }, CTX('admin-1'))).ok).toBe(true);
  });
});
