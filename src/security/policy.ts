export function isAdmin(authorId: string, adminUserId: string): boolean {
  return authorId === adminUserId;
}

export function hasMutationRole(memberRoleIds: string[], allowedRoleIds: string[]): boolean {
  if (allowedRoleIds.length === 0) return false;
  return memberRoleIds.some((r) => allowedRoleIds.includes(r));
}

export type MutationTool =
  | 'save_world'
  | 'restart_server'
  | 'start_server'
  | 'stop_server'
  | 'broadcast_server_message'
  | 'cancel_pending_mod_restart'
  | 'check_mod_updates';

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  clampedWarningMinutes?: number;
}

export function clampWarningMinutes(requested: number, min: number): number {
  if (!Number.isInteger(requested)) throw new Error('warning_minutes must be an integer');
  if (requested < 0 || requested > 60) throw new Error('warning_minutes must be in range 0..60');
  return Math.max(requested, min);
}

export function decideMutation(params: {
  tool: MutationTool;
  isAdminUser: boolean;
  hasRole: boolean;
  config: {
    publicSave: boolean;
    publicRestart: boolean;
    nonAdminRestartMinWarning: number;
    enableModTools: boolean;
    enableBroadcastTool: boolean;
  };
  warningMinutes?: number;
}): PolicyDecision {
  const { tool, isAdminUser, hasRole, config } = params;
  const privileged = isAdminUser || hasRole;

  switch (tool) {
    case 'save_world':
      if (privileged || config.publicSave) return { allowed: true, reason: 'save allowed' };
      return { allowed: false, reason: 'save not public and requester not privileged' };
    case 'restart_server': {
      if (privileged) {
        const w = params.warningMinutes ?? 5;
        if (w < 0 || w > 60) return { allowed: false, reason: 'warning_minutes out of range' };
        return { allowed: true, reason: 'restart allowed for privileged' };
      }
      if (!config.publicRestart) return { allowed: false, reason: 'restart not public' };
      const requested = params.warningMinutes ?? config.nonAdminRestartMinWarning;
      try {
        const clamped = clampWarningMinutes(requested, config.nonAdminRestartMinWarning);
        return { allowed: true, reason: 'restart allowed with minimum warning', clampedWarningMinutes: clamped };
      } catch {
        return { allowed: false, reason: 'warning_minutes out of range' };
      }
    }
    case 'start_server':
    case 'stop_server':
    case 'cancel_pending_mod_restart':
      if (privileged) return { allowed: true, reason: `${tool} allowed for privileged` };
      return { allowed: false, reason: `${tool} requires Xainner or authorized role` };
    case 'broadcast_server_message':
      if (!config.enableBroadcastTool) return { allowed: false, reason: 'broadcast tool disabled' };
      if (privileged) return { allowed: true, reason: 'broadcast allowed for privileged' };
      return { allowed: false, reason: 'broadcast requires Xainner or authorized role' };
    case 'check_mod_updates':
      if (!config.enableModTools) return { allowed: false, reason: 'mod tools disabled' };
      return { allowed: true, reason: 'mod check allowed' };
    default:
      return { allowed: false, reason: 'unknown mutation tool' };
  }
}
