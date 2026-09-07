import { describe, expect, it } from 'vitest';
import { clampWarningMinutes, decideMutation, hasMutationRole, isXainner } from '../src/security/policy.js';

const base = {
  publicSave: true,
  publicRestart: true,
  nonXainnerRestartMinWarning: 5,
  enableModTools: true,
  enableBroadcastTool: true,
};

describe('policy', () => {
  it('recognizes Xainner by exact ID', () => {
    expect(isXainner('339977677811482634', '339977677811482634')).toBe(true);
    expect(isXainner('123', '339977677811482634')).toBe(false);
  });

  it('same nickname but different ID is not Xainner', () => {
    expect(isXainner('999', '339977677811482634')).toBe(false);
  });

  it('clamps non-Xainner restart to minimum', () => {
    const d = decideMutation({ tool: 'restart_server', isXainnerUser: false, hasRole: false, config: base, warningMinutes: 0 });
    expect(d.allowed).toBe(true);
    expect(d.clampedWarningMinutes).toBe(5);
  });

  it('denies start/stop for normal users', () => {
    expect(decideMutation({ tool: 'start_server', isXainnerUser: false, hasRole: false, config: base }).allowed).toBe(false);
    expect(decideMutation({ tool: 'stop_server', isXainnerUser: false, hasRole: false, config: base }).allowed).toBe(false);
  });

  it('allows privileged start/stop', () => {
    expect(decideMutation({ tool: 'start_server', isXainnerUser: true, hasRole: false, config: base }).allowed).toBe(true);
  });

  it('allows role-based mutation', () => {
    expect(hasMutationRole(['111', '222'], ['222'])).toBe(true);
    expect(hasMutationRole(['111'], ['222'])).toBe(false);
  });

  it('rejects out of range warning', () => {
    expect(() => clampWarningMinutes(-1, 5)).toThrow();
    expect(() => clampWarningMinutes(61, 5)).toThrow();
  });
});
