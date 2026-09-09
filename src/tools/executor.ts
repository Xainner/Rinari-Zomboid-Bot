import { PanelClient } from '../panel/client.js';
import { AppConfig } from '../config.js';
import { decideMutation, hasMutationRole, isAdmin, MutationTool } from '../security/policy.js';
import { assertKnownTool, isLifecycleTool, releaseLifecycleLock, tryAcquireLifecycleLock, validateToolArgs, ToolName } from './registry.js';
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

  async execute(tool: string, rawArgs: unknown, ctx: ExecutionContext): Promise<ExecutionResult> {
    const started = Date.now();
    try {
      assertKnownTool(tool);
      const args = (rawArgs ?? {}) as Record<string, unknown>;
      validateToolArgs(tool as ToolName, args);

      const privileged = isAdmin(ctx.authorId, this.config.adminUserId);
      const hasRole = hasMutationRole(ctx.memberRoleIds, this.config.mutationAllowedRoleIds);

      if (this.isReadOnly(tool as ToolName)) {
        if ((tool === 'get_mod_status' || tool === 'check_mod_updates') && !this.config.enableModTools) {
          return { ok: false, denied: true, error: 'Mod tools are disabled' };
        }
        const data = await this.runRead(tool as ToolName, args);
        logger.info('tool_execution', {
          tool,
          requesterId: ctx.authorId,
          server: this.config.pzServerName,
          authorized: true,
          durationMs: Date.now() - started,
          ok: true,
        });
        return { ok: true, data };
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
          durationMs: Date.now() - started,
          ok: false,
        });
        return { ok: false, denied: true, error: decision.reason };
      }

      if (isLifecycleTool(tool)) {
        if (!tryAcquireLifecycleLock()) {
          return { ok: false, denied: true, error: 'Another lifecycle operation is already in progress' };
        }
        try {
          const sinceLast = Date.now() - (this.lastLifecycleAt.get(tool) ?? 0);
          if (sinceLast < ToolExecutor.LIFECYCLE_DEDUPE_MS) {
            const waitS = Math.ceil((ToolExecutor.LIFECYCLE_DEDUPE_MS - sinceLast) / 1000);
            logger.info('tool_execution', {
              tool,
              requesterId: ctx.authorId,
              server: this.config.pzServerName,
              authorized: false,
              durationMs: Date.now() - started,
              ok: false,
            });
            return {
              ok: false,
              denied: true,
              error: `${tool} was already executed ${Math.floor(sinceLast / 1000)}s ago. Not repeating it; wait ${waitS}s before asking again.`,
            };
          }
          const data = await this.runMutation(tool as ToolName, args, decision.clampedWarningMinutes);
          this.lastLifecycleAt.set(tool, Date.now());
          logger.info('tool_execution', {
            tool,
            requesterId: ctx.authorId,
            server: this.config.pzServerName,
            authorized: true,
            durationMs: Date.now() - started,
            ok: true,
            args: ToolExecutor.safeArgs(tool as ToolName, args, decision.clampedWarningMinutes),
          });
          return { ok: true, data };
        } finally {
          releaseLifecycleLock();
        }
      }

      const data = await this.runMutation(tool as ToolName, args, decision.clampedWarningMinutes);
      logger.info('tool_execution', {
        tool,
        requesterId: ctx.authorId,
        server: this.config.pzServerName,
        authorized: true,
        durationMs: Date.now() - started,
        ok: true,
      });
      return { ok: true, data };
    } catch (err) {
      logger.warn('tool_execution', {
        tool,
        requesterId: ctx.authorId,
        server: this.config.pzServerName,
        authorized: false,
        durationMs: Date.now() - started,
        ok: false,
        // Sanitized: without this, failures like tonight's expired-token
        // 401s are indistinguishable from policy denials in the logs.
        error: sanitizeForLog(err instanceof Error ? `${err.name}: ${err.message}` : String(err)),
      });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
      default:
        throw new Error(`Not a mutation tool: ${tool}`);
    }
  }
}
