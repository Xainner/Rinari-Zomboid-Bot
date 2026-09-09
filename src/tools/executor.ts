import { PanelClient } from '../panel/client.js';
import { AppConfig } from '../config.js';
import { decideMutation, hasMutationRole, isAdmin, MutationTool } from '../security/policy.js';
import { assertKnownTool, isLifecycleTool, releaseLifecycleLock, tryAcquireLifecycleLock, validateToolArgs, ADMIN_ONLY_TOOLS, ToolName } from './registry.js';
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
            durationMs: Date.now() - started,
            ok: false,
            error: 'admin only',
          });
          return { ok: false, denied: true, error: 'Solo Xainner puede usar esa herramienta.' };
        }
        const data = this.isReadOnly(tool as ToolName)
          ? await this.runRead(tool as ToolName, args)
          : await this.runMutation(tool as ToolName, args, undefined);
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
