import { PanelClient } from '../panel/client.js';
import { PanelError } from '../panel/types.js';
import { AppConfig } from '../config.js';
import { decideMutation, hasMutationRole, isAdmin, MutationTool } from '../security/policy.js';
import { assertKnownTool, isLifecycleTool, releaseLifecycleLock, tryAcquireLifecycleLock, validateToolArgs, ADMIN_ONLY_TOOLS, ToolName } from './registry.js';
import { concurrencyDomainForTool, releaseDomainLock, tryAcquireDomainLock } from './concurrency.js';
import { newActionId, ToolStatus } from './toolResult.js';
import { sanitizeForLog } from '../security/sanitize.js';
import { logger } from '../util/logger.js';

export interface ExecutionContext {
  authorId: string;
  memberRoleIds: string[];
  channelId: string;
}

export interface ExecutionResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  denied?: boolean;
  /** Harness v2 standard fields (doc 01 sections 3-4). Kept alongside ok/denied for compat. */
  status?: ToolStatus;
  code?: string;
  /** Machine-readable reason, e.g. requester_is_not_admin. Never dialogue for Discord. */
  reason?: string;
  /** Tool name that was attempted. Helps the LLM redact without guessing. */
  tool?: string;
  retryable?: boolean;
  actionId?: string;
  durationMs?: number;
  sideEffect?: boolean;
  verified?: boolean;
}

export class ToolExecutor {
  constructor(
    private panel: PanelClient,
    private config: AppConfig,
  ) {}

  private lastLifecycleAt = new Map<string, number>();

  private static readonly LIFECYCLE_DEDUPE_MS = 120_000;

  static resetLifecycleDedupeForTests(executor: ToolExecutor): void {
    executor.lastLifecycleAt.clear();
  }

  private mapErrorToResult(tool: string, err: unknown, started: number, actionId: string, isMutation = false): ExecutionResult {
    const durationMs = Date.now() - started;
    const rawMsg = err instanceof Error ? err.message : String(err);
    // Unknown tool: fail-closed, never retryable.
    if (/^UNKNOWN_TOOL/.test(rawMsg)) {
      return { ok: false, error: rawMsg, status: 'failed', code: 'UNKNOWN_TOOL', retryable: false, actionId, durationMs, sideEffect: false, verified: false };
    }
    // Schema/validation failures are explicit, never silent {}.
    if (/Invalid argument|must be|is required|in range|range|invalid format/i.test(rawMsg)) {
      return { ok: false, error: rawMsg, status: 'failed', code: 'INVALID_TOOL_ARGUMENTS', retryable: false, actionId, durationMs, sideEffect: false, verified: false };
    }
    if (err instanceof PanelError) {
      if (err.code === 'REQUEST_TIMEOUT_AFTER_SEND' || err.code === 'REQUEST_SEND_AMBIGUOUS') {
        return {
          ok: false,
          error: `${err.code}: outcome unknown, verify via GET before retry`,
          status: 'unknown_outcome',
          code: err.code,
          reason: 'timeout_after_send',
          tool,
          retryable: false,
          actionId,
          durationMs,
          sideEffect: true,
          verified: false,
        };
      }
      if (err.status === 408 || err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504) {
        // Reads may retry; mutations must never auto-retry a POST that could
        // have executed. Surface unknown_outcome so the caller verifies via GET.
        if (isMutation) {
          return {
            ok: false,
            error: `PANEL_${err.status}_AFTER_SEND: outcome unknown, verify via GET before retry`,
            status: 'unknown_outcome',
            code: `PANEL_${err.status}_AFTER_SEND`,
            reason: 'transient_after_send',
            tool,
            retryable: false,
            actionId,
            durationMs,
            sideEffect: true,
            verified: false,
          };
        }
        return { ok: false, error: rawMsg, status: 'retryable_error', code: `PANEL_${err.status}`, retryable: true, actionId, durationMs, sideEffect: false, verified: false };
      }
      if (err.status === 403 || err.code === 'FORBIDDEN') {
        return { ok: false, error: rawMsg, status: 'failed', code: 'PANEL_FORBIDDEN', retryable: false, actionId, durationMs, sideEffect: false, verified: false };
      }
      if (err.status === 409 || err.code === 'CONFLICT') {
        return { ok: false, error: rawMsg, status: 'failed', code: 'PANEL_CONFLICT', retryable: false, actionId, durationMs, sideEffect: false, verified: false };
      }
    }
    if (/Active server mismatch/.test(rawMsg)) {
      return { ok: false, error: rawMsg, status: 'failed', code: 'SERVER_MISMATCH', retryable: false, actionId, durationMs, sideEffect: false, verified: false };
    }
    return { ok: false, error: rawMsg, status: 'failed', retryable: false, actionId, durationMs, sideEffect: false, verified: false };
  }

  async execute(tool: string, rawArgs: unknown, ctx: ExecutionContext): Promise<ExecutionResult> {
    const started = Date.now();
    const actionId = newActionId();
    const duration = (): number => Date.now() - started;
    try {
      assertKnownTool(tool);
      const args = (rawArgs ?? {}) as Record<string, unknown>;
      validateToolArgs(tool as ToolName, args);

      const privileged = isAdmin(ctx.authorId, this.config.adminUserId);
      const hasRole = hasMutationRole(ctx.memberRoleIds, this.config.mutationAllowedRoleIds);

      // Admin-only tools: no role bypass, no exceptions. The LLM is told
      // these fail for anyone else, so it should not offer them publicly.
      // Privileged requests run directly: these tools bypass decideMutation
      // (which only knows the classic mutation set).
      if (ADMIN_ONLY_TOOLS.has(tool)) {
        if (!privileged) {
          logger.info('tool_execution', {
            tool,
            requesterId: ctx.authorId,
            server: this.config.pzServerName,
            authorized: false,
            durationMs: duration(),
            ok: false,
            error: 'admin only',
            actionId,
            status: 'denied',
          });
          return { ok: false, denied: true, error: 'ADMIN_ONLY: requester_is_not_admin', status: 'denied', code: 'ADMIN_ONLY', reason: 'requester_is_not_admin', tool, retryable: false, actionId, durationMs: duration(), sideEffect: false, verified: false };
        }
        const toolName = tool as ToolName;
        if (this.isReadOnly(toolName)) {
          const data = await this.runRead(toolName, args);
          logger.info('tool_execution', {
            tool,
            requesterId: ctx.authorId,
            server: this.config.pzServerName,
            authorized: true,
            durationMs: duration(),
            ok: true,
            actionId,
            status: 'success',
          });
          return { ok: true, data, status: 'success', actionId, durationMs: duration(), sideEffect: false, verified: false };
        }
        // Admin mutation: domain lock, no lifecycle dedupe bypass.
        const domain = concurrencyDomainForTool(toolName);
        if (!tryAcquireDomainLock(this.config.pzServerName, domain)) {
          return { ok: false, denied: true, error: 'DOMAIN_BUSY', status: 'denied', code: 'DOMAIN_BUSY', reason: 'domain_locked', tool, retryable: true, actionId, durationMs: duration(), sideEffect: false, verified: false };
        }
        try {
          const data = await this.runMutation(toolName, args, undefined);
          logger.info('tool_execution', {
            tool,
            requesterId: ctx.authorId,
            server: this.config.pzServerName,
            authorized: true,
            durationMs: duration(),
            ok: true,
            actionId,
            status: 'success',
          });
          return { ok: true, data, status: 'success', actionId, durationMs: duration(), sideEffect: true, verified: false };
        } finally {
          releaseDomainLock(this.config.pzServerName, domain);
        }
      }

      if (this.isReadOnly(tool as ToolName)) {
        if ((tool === 'get_mod_status' || tool === 'check_mod_updates') && !this.config.enableModTools) {
          return { ok: false, denied: true, error: 'FEATURE_DISABLED: mod_tools_disabled', status: 'denied', code: 'FEATURE_DISABLED', reason: 'mod_tools_disabled', tool, retryable: false, actionId, durationMs: duration(), sideEffect: false, verified: false };
        }
        const data = await this.runRead(tool as ToolName, args);
        logger.info('tool_execution', {
          tool,
          requesterId: ctx.authorId,
          server: this.config.pzServerName,
          authorized: true,
          durationMs: duration(),
          ok: true,
          actionId,
          status: 'success',
        });
        return { ok: true, data, status: 'success', actionId, durationMs: duration(), sideEffect: false, verified: false };
      }

      const decision = decideMutation({
        tool: tool as MutationTool,
        isAdminUser: privileged,
        hasRole,
        config: {
          publicSave: this.config.publicSave,
          publicRestart: this.config.publicRestart,
          nonAdminRestartMinWarning: this.config.nonAdminRestartMinWarning,
          enableModTools: this.config.enableModTools,
          enableBroadcastTool: this.config.enableBroadcastTool,
        },
        warningMinutes:
          typeof args['warning_minutes'] === 'number' ? (args['warning_minutes'] as number) : undefined,
      });
      if (!decision.allowed) {
        logger.info('tool_execution', {
          tool,
          requesterId: ctx.authorId,
          server: this.config.pzServerName,
          authorized: false,
          durationMs: duration(),
          ok: false,
          actionId,
          status: 'denied',
        });
        return { ok: false, denied: true, error: `POLICY_DENIED: ${decision.reason}`, status: 'denied', code: 'POLICY_DENIED', reason: decision.reason, tool, retryable: false, actionId, durationMs: duration(), sideEffect: false, verified: false };
      }

      const toolName = tool as ToolName;
      const domain = concurrencyDomainForTool(toolName);
      if (!tryAcquireDomainLock(this.config.pzServerName, domain)) {
        return { ok: false, denied: true, error: 'DOMAIN_BUSY', status: 'denied', code: 'DOMAIN_BUSY', reason: 'domain_locked', tool, retryable: true, actionId, durationMs: duration(), sideEffect: false, verified: false };
      }
      try {
        if (isLifecycleTool(tool)) {
          if (!tryAcquireLifecycleLock()) {
            return { ok: false, denied: true, error: 'LIFECYCLE_BUSY', status: 'denied', code: 'LIFECYCLE_BUSY', reason: 'lifecycle_locked', tool, retryable: true, actionId, durationMs: duration(), sideEffect: false, verified: false };
          }
          try {
            const sinceLast = Date.now() - (this.lastLifecycleAt.get(tool) ?? 0);
            if (sinceLast < ToolExecutor.LIFECYCLE_DEDUPE_MS) {
              logger.info('tool_execution', {
                tool,
                requesterId: ctx.authorId,
                server: this.config.pzServerName,
                authorized: false,
                durationMs: duration(),
                ok: false,
                actionId,
                status: 'denied',
              });
              return {
                ok: false,
                denied: true,
                error: 'LIFECYCLE_DEDUPE',
                status: 'denied',
                code: 'LIFECYCLE_DEDUPE',
                reason: 'lifecycle_dedupe',
                tool,
                retryable: false,
                actionId,
                durationMs: duration(),
                sideEffect: false,
                verified: false,
              };
            }
            const data = await this.runMutation(toolName, args, decision.clampedWarningMinutes);
            this.lastLifecycleAt.set(tool, Date.now());
            logger.info('tool_execution', {
              tool,
              requesterId: ctx.authorId,
              server: this.config.pzServerName,
              authorized: true,
              durationMs: duration(),
              ok: true,
              actionId,
              status: 'success',
              args: ToolExecutor.safeArgs(toolName, args, decision.clampedWarningMinutes),
            });
            return { ok: true, data, status: 'success', actionId, durationMs: duration(), sideEffect: true, verified: false };
          } finally {
            releaseLifecycleLock();
          }
        }

        const data = await this.runMutation(toolName, args, decision.clampedWarningMinutes);
        logger.info('tool_execution', {
          tool,
          requesterId: ctx.authorId,
          server: this.config.pzServerName,
          authorized: true,
          durationMs: duration(),
          ok: true,
          actionId,
          status: 'success',
        });
        return { ok: true, data, status: 'success', actionId, durationMs: duration(), sideEffect: true, verified: false };
      } finally {
        releaseDomainLock(this.config.pzServerName, domain);
      }
    } catch (err) {
      // Mutations that fail ambiguously must surface unknown_outcome, never retryable.
      let isMutation = false;
      try {
        const known = tool as ToolName;
        isMutation = !this.isReadOnly(known) || isLifecycleTool(tool) || ADMIN_ONLY_TOOLS.has(tool);
        // check_mod_updates is dual: read path but POSTs; treat as mutation for safety.
        if (tool === 'check_mod_updates') isMutation = true;
      } catch {
        isMutation = false;
      }
      const mapped = this.mapErrorToResult(tool, err, started, actionId, isMutation);
      logger.warn('tool_execution', {
        tool,
        requesterId: ctx.authorId,
        server: this.config.pzServerName,
        authorized: false,
        durationMs: mapped.durationMs,
        ok: false,
        actionId,
        status: mapped.status,
        code: mapped.code,
        // Sanitized: without this, failures like expired-token
        // 401s are indistinguishable from policy denials in the logs.
        error: sanitizeForLog(err instanceof Error ? `${err.name}: ${err.message}` : String(err)),
      });
      return mapped;
    }
  }

  private static safeArgs(tool: ToolName, args: Record<string, unknown>, clampedWarning?: number): Record<string, unknown> {
    if (tool === 'restart_server') {
      return { warning_minutes: clampedWarning ?? args['warning_minutes'] };
    }
    if (tool === 'broadcast_server_message') {
      return { message_length: typeof args['message'] === 'string' ? args['message'].length : 0 };
    }
    return {};
  }

  private isReadOnly(tool: ToolName): boolean {
    return (
      tool === 'get_server_status' ||
      tool === 'get_players' ||
      tool === 'get_player_hours' ||
      tool === 'get_player_activity' ||
      tool === 'get_death_ranking' ||
      tool === 'get_mod_updates_detail' ||
      tool === 'get_next_maintenance' ||
      tool === 'get_backups' ||
      tool === 'get_world_info' ||
      tool === 'get_recent_errors' ||
      tool === 'get_player_position' ||
      tool === 'get_mod_status' ||
      tool === 'check_mod_updates'
    );
  }

  private async runRead(tool: ToolName, args: Record<string, unknown>): Promise<unknown> {
    switch (tool) {
      case 'get_server_status':
        return this.panel.getArkno2Status();
      case 'get_players':
        return this.panel.getPlayers();
      case 'get_player_hours':
        return this.panel.getPlayerHours(args['player_name'] as string | undefined);
      case 'get_player_activity':
        return this.panel.getPlayerActivity(
          args['player_name'] as string | undefined,
          args['action'] as string | undefined,
          typeof args['limit'] === 'number' ? (args['limit'] as number) : undefined,
        );
      case 'get_death_ranking':
        return this.panel.getDeathRanking(
          typeof args['limit'] === 'number' ? (args['limit'] as number) : undefined,
        );
      case 'get_mod_updates_detail':
        return this.panel.getModUpdatesDetail();
      case 'get_next_maintenance':
        return this.panel.getNextMaintenance();
      case 'get_backups':
        return this.panel.getBackups(
          typeof args['limit'] === 'number' ? (args['limit'] as number) : undefined,
        );
      case 'get_world_info':
        return this.panel.getWorldInfo();
      case 'get_recent_errors':
        return this.panel.getRecentErrors(
          typeof args['limit'] === 'number' ? (args['limit'] as number) : undefined,
        );
      case 'get_player_position':
        return this.panel.getPlayerPosition(args['player_name'] as string | undefined);
      case 'get_mod_status':
        return this.panel.getModStatus();
      case 'check_mod_updates':
        return this.panel.checkModUpdates();
      default:
        throw new Error(`Not a read tool: ${tool}`);
    }
  }

  private async runMutation(tool: ToolName, args: Record<string, unknown>, clampedWarning?: number): Promise<unknown> {
    switch (tool) {
      case 'save_world':
        return this.panel.saveWorld();
      case 'restart_server': {
        const requested = args['warning_minutes'] as number;
        return this.panel.restartServer(clampedWarning ?? requested);
      }
      case 'start_server':
        return this.panel.startServer();
      case 'stop_server':
        return this.panel.stopServer();
      case 'broadcast_server_message':
        return this.panel.sendServerMessage(args['message'] as string);
      case 'cancel_pending_mod_restart':
        return this.panel.cancelPendingModRestart();
      case 'check_mod_updates':
        return this.panel.checkModUpdates();
      case 'kick_player':
        return this.panel.kickPlayer(
          args['player_name'] as string,
          args['reason'] as string | undefined,
        );
      case 'ban_player':
        return this.panel.banPlayer(
          args['player_name'] as string,
          args['ban_ip'] as boolean | undefined,
          args['reason'] as string | undefined,
        );
      case 'unban_player':
        return this.panel.unbanPlayer(args['player_name'] as string);
      case 'teleport_player':
        return this.panel.teleportPlayer(
          args['player_name'] as string,
          args['target_player'] as string | undefined,
          args['x'] as number | undefined,
          args['y'] as number | undefined,
          args['z'] as number | undefined,
        );
      case 'give_item':
        return this.panel.giveItem(
          args['player_name'] as string,
          args['item'] as string,
          typeof args['count'] === 'number' ? (args['count'] as number) : undefined,
        );
      case 'set_godmode':
        return this.panel.setGodmode(args['player_name'] as string, args['enabled'] as boolean);
      default:
        throw new Error(`Not a mutation tool: ${tool}`);
    }
  }
}
