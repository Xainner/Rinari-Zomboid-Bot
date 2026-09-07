export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const BASE_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_server_status',
      description: 'Obtiene el estado actual del servidor Project Zomboid ARKNO2.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_players',
      description: 'Consulta jugadores conectados a ARKNO2.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_world',
      description: 'Solicita al panel guardar el mundo de ARKNO2.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'restart_server',
      description: 'Reinicia ARKNO2 mediante Zomboid Control Panel con aviso previo.',
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
      description: 'Arranca el servidor ARKNO2. Solo Xainner o rol autorizado.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_server',
      description: 'Detiene de forma graceful el servidor ARKNO2. Solo Xainner o rol autorizado.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];

const MOD_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_mod_status',
      description: 'Consulta el estado del monitor de mods de ARKNO2 y si existe un reinicio pendiente por updates.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_mod_updates',
      description: 'Solicita al Zomboid Control Panel verificar actualizaciones de mods configurados en ARKNO2.',
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
];

const BROADCAST_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'broadcast_server_message',
    description: 'Envia un mensaje de sistema a los jugadores de ARKNO2.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', minLength: 1, maxLength: 300 },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
};

export function buildToolDefinitions(opts: { enableModTools: boolean; enableBroadcastTool: boolean }): ToolDefinition[] {
  const tools = [...BASE_TOOLS];
  if (opts.enableModTools) tools.push(...MOD_TOOLS);
  if (opts.enableBroadcastTool) tools.push(BROADCAST_TOOL);
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
