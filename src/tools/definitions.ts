export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolBuildOptions {
  enableModTools: boolean;
  enableBroadcastTool: boolean;
  serverName: string;
}

export function buildToolDefinitions(opts: ToolBuildOptions): ToolDefinition[] {
  const { serverName } = opts;
  const tools: ToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'get_server_status',
        description: `Obtiene el estado actual del servidor Project Zomboid ${serverName}.`,
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_players',
        description: `Consulta jugadores conectados a ${serverName}.`,
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'save_world',
        description: `Solicita al panel guardar el mundo de ${serverName}.`,
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'restart_server',
        description: `Reinicia ${serverName} mediante Zomboid Control Panel con aviso previo.`,
        parameters: {
          type: 'object',
          properties: {
            warning_minutes: {
              type: 'integer',
              minimum: 0,
              maximum: 60,
              description: 'Minutos de aviso antes del reinicio.',
            },
            reason: { type: 'string', maxLength: 240 },
          },
          required: ['warning_minutes'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'start_server',
        description: `Arranca el servidor ${serverName}. Solo Xainner o rol autorizado.`,
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'stop_server',
        description: `Detiene de forma graceful el servidor ${serverName}. Solo Xainner o rol autorizado.`,
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
  ];
  if (opts.enableModTools) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'get_mod_status',
          description: `Consulta el estado del monitor de mods de ${serverName} y si existe un reinicio pendiente por updates.`,
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      },
      {
        type: 'function',
        function: {
          name: 'check_mod_updates',
          description: `Solicita al Zomboid Control Panel verificar actualizaciones de mods configurados en ${serverName}.`,
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cancel_pending_mod_restart',
          description: 'Cancela un reinicio pendiente por mods. Solo Xainner o rol autorizado.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      },
    );
  }
  if (opts.enableBroadcastTool) {
    tools.push({
      type: 'function',
      function: {
        name: 'broadcast_server_message',
        description: `Envia un mensaje de sistema a los jugadores de ${serverName}.`,
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 300 },
          },
          required: ['message'],
          additionalProperties: false,
        },
      },
    });
  }
  return tools;
}

export const ALLOWED_TOOL_NAMES = new Set([
  'get_server_status',
  'get_players',
  'get_mod_status',
  'check_mod_updates',
  'save_world',
  'restart_server',
  'start_server',
  'stop_server',
  'broadcast_server_message',
  'cancel_pending_mod_restart',
]);
