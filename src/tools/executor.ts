import { PanelClient } from '../panel/client.js';
import { AppConfig } from '../config.js';
import { decideMutation, hasMutationRole, isAdmin, MutationTool } from '../security/policy.js';
import { assertKnownTool, isLifecycleTool, releaseLifecycleLock, tryAcquireLifecycleLock, validateToolArgs, ToolName } from './registry.js';
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
        const data = await this.runRead(tool as ToolName);
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
          const data = await this.runMutation(tool as ToolName, args, decision.clampedWarningMinutes);
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
      });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private isReadOnly(tool: ToolName): boolean {
    return tool === 'get_server_status' || tool === 'get_players' || tool === 'get_mod_status' || tool === 'check_mod_updates';
  }

  private async runRead(tool: ToolName): Promise<unknown> {
    switch (tool) {
      case 'get_server_status':
        return this.panel.getArkno2Status();
      case 'get_players':
        return this.panel.getPlayers();
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
