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
        name: 'get_player_hours',
        description: `Consulta horas jugadas en ${serverName} segun el registro del panel (no son horas de Steam). Sin player_name devuelve el ranking top 10; con player_name, la ficha de ese jugador.`,
        parameters: {
          type: 'object',
          properties: {
            player_name: {
              type: 'string',
              minLength: 1,
              maxLength: 64,
              description: 'Nombre del jugador. Omitelo para ver el ranking.',
            },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_player_activity',
        description: `Consulta actividad reciente de jugadores de ${serverName}: conexiones, desconexiones y muertes. Permite filtrar por jugador y por tipo.`,
        parameters: {
          type: 'object',
          properties: {
            player_name: {
              type: 'string',
              minLength: 1,
              maxLength: 64,
              description: 'Nombre del jugador. Omitelo para ver actividad general.',
            },
            action: {
              type: 'string',
              enum: ['connect', 'disconnect', 'death'],
              description: 'Filtra por tipo de evento.',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 20,
              description: 'Maximo de eventos a devolver (default 10).',
            },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_death_ranking',
        description: `Quienes mueren mas en ${serverName}, segun las ultimas 100 actividades registradas.`,
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Tamano del ranking (default 5).' },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_mod_updates_detail',
        description: `Lista con nombre que mods de ${serverName} tienen actualizacion disponible. Vacio significa todo al dia.`,
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_next_maintenance',
        description: `Proxima tarea programada de ${serverName} (backup o reinicio) segun el scheduler del panel.`,
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_backups',
        description: `Estado de los backups de ${serverName}: ultimo backup, cantidad y lista reciente (nombres y tamanos, sin rutas).`,
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Backups recientes a listar (default 5).' },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_world_info',
        description: `Hora del juego, clima, zombies y mapa de ${serverName} via PanelBridge. Sin datos de jugadores.`,
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_recent_errors',
        description: `Ultimas lineas de error de la consola de ${serverName}, sanitizadas. Solo Xainner.`,
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Lineas a devolver (default 10).' },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_player_position',
        description: `Posicion en vivo (x, y, z) y salud de jugadores de ${serverName}. Sin player_name lista a todos. Solo Xainner: nunca reveles coordenadas de otros a nadie mas.`,
        parameters: {
          type: 'object',
          properties: {
            player_name: { type: 'string', minLength: 1, maxLength: 64, description: 'Omitelo para ver a todos.' },
          },
          required: [],
          additionalProperties: false,
        },
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
  'get_player_hours',
  'get_player_activity',
  'get_death_ranking',
  'get_mod_updates_detail',
  'get_next_maintenance',
  'get_backups',
  'get_world_info',
  'get_recent_errors',
  'get_player_position',
  'get_mod_status',
  'check_mod_updates',
  'save_world',
  'restart_server',
  'start_server',
  'stop_server',
  'broadcast_server_message',
  'cancel_pending_mod_restart',
]);
