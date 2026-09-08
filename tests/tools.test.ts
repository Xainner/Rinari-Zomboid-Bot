import { describe, expect, it } from 'vitest';
import { assertKnownTool, validateToolArgs } from '../src/tools/registry.js';
import { buildToolDefinitions } from '../src/tools/definitions.js';

describe('tools', () => {
  it('only registered tools exist', () => {
    expect(() => assertKnownTool('shell')).toThrow(/UNKNOWN_TOOL/);
    expect(() => assertKnownTool('rcon_execute')).toThrow(/UNKNOWN_TOOL/);
    expect(() => assertKnownTool('restart_server')).not.toThrow();
  });

  it('rejects extra args', () => {
    expect(() => validateToolArgs('restart_server', { warning_minutes: 5, server: 'otro' } as unknown as Record<string, unknown>)).toThrow();
  });

  it('rejects out of range warning', () => {
    expect(() => validateToolArgs('restart_server', { warning_minutes: -1 })).toThrow();
    expect(() => validateToolArgs('restart_server', { warning_minutes: 61 })).toThrow();
  });

  it('no generic RCON tool exists', () => {
    const tools = buildToolDefinitions({ enableModTools: true, enableBroadcastTool: true, serverName: 'ARKNO2' });
    const names = tools.map((t) => t.function.name);
    expect(names).not.toContain('rcon_execute');
    expect(names).not.toContain('panel_request');
    expect(names).not.toContain('http_request');
  });

  it('conditional tools toggle', () => {
    const off = buildToolDefinitions({ enableModTools: false, enableBroadcastTool: false, serverName: 'ARKNO2' });
    const names = off.map((t) => t.function.name);
    expect(names).not.toContain('get_mod_status');
    expect(names).not.toContain('broadcast_server_message');
  });

  it('player stats tools are always registered', () => {
    const tools = buildToolDefinitions({ enableModTools: false, enableBroadcastTool: false, serverName: 'ARKNO2' });
    const names = tools.map((t) => t.function.name);
    expect(names).toContain('get_player_hours');
    expect(names).toContain('get_player_activity');
  });

  it('validates player activity args', () => {
    expect(() => validateToolArgs('get_player_hours', { player_name: 'Wachita' })).not.toThrow();
    expect(() => validateToolArgs('get_player_hours', { player_name: '' })).toThrow();
    expect(() => validateToolArgs('get_player_hours', { player_name: 'x', server: 'otro' } as unknown as Record<string, unknown>)).toThrow();
    expect(() => validateToolArgs('get_player_activity', { action: 'ban' })).toThrow();
    expect(() => validateToolArgs('get_player_activity', { action: 'death', limit: 5 })).not.toThrow();
    expect(() => validateToolArgs('get_player_activity', { limit: 0 })).toThrow();
    expect(() => validateToolArgs('get_player_activity', { limit: 21 })).toThrow();
  });
});
