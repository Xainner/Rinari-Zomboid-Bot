export function progressForTool(tool: string, isXainner: boolean, serverName: string): string | null {
  if (isXainner) {
    switch (tool) {
      case 'restart_server':
        return `Si, Xainner. Reviso que siga siendo ${serverName} y preparo el reinicio. Solo toco el servidor, nada mas.`;
      case 'save_world':
        return `Claro, Xainner. Guardo ${serverName} ahora mismo.`;
      case 'start_server':
        return `Voy, Xainner. Reviso ${serverName} e intento arrancarlo.`;
      case 'stop_server':
        return `Entendido, Xainner. Detengo ${serverName} de forma graceful.`;
      case 'broadcast_server_message':
        return `Listo, Xainner. Envio tu mensaje a ${serverName}.`;
      case 'check_mod_updates':
        return `Reviso los mods de ${serverName}, Xainner. Sin tocar nada mas.`;
      case 'cancel_pending_mod_restart':
        return `Reviso el reinicio pendiente de ${serverName}, Xainner.`;
      default:
        return null;
    }
  }
  switch (tool) {
    case 'restart_server':
      return `Reiniciar? Claro, pedir es facil. Reviso ${serverName} y, si cuadra, dejo el aviso corriendo.`;
    case 'save_world':
      return `Voy a guardar ${serverName}. Un momento.`;
    case 'start_server':
    case 'stop_server':
      return 'Eso lo decide Xainner o un rol autorizado. Reviso permisos primero.';
    case 'broadcast_server_message':
      return `Un mensaje para ${serverName}? Lo reviso.`;
    case 'check_mod_updates':
      return `A ver que rompieron ahora. Reviso los mods de ${serverName}.`;
    default:
      return null;
  }
}

export function resultForDenial(reason: string, isXainner: boolean, serverName: string): string {
  if (isXainner) return `No pude hacerlo, Xainner: ${reason}. No voy a fingir que salio bien.`;
  return `No. ${reason}. Yo cuido ${serverName}, no hago milagros fuera de mis permisos.`;
}
