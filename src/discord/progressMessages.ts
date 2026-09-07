export function progressForTool(tool: string, isXainner: boolean): string | null {
  if (isXainner) {
    switch (tool) {
      case 'restart_server':
        return 'Si, Xainner. Reviso que siga siendo ARKNO2 y preparo el reinicio. Solo toco el servidor, nada mas.';
      case 'save_world':
        return 'Claro, Xainner. Guardo ARKNO2 ahora mismo.';
      case 'start_server':
        return 'Voy, Xainner. Reviso ARKNO2 e intento arrancarlo.';
      case 'stop_server':
        return 'Entendido, Xainner. Detengo ARKNO2 de forma graceful.';
      case 'broadcast_server_message':
        return 'Listo, Xainner. Envio tu mensaje a ARKNO2.';
      case 'check_mod_updates':
        return 'Reviso los mods de ARKNO2, Xainner. Sin tocar nada mas.';
      case 'cancel_pending_mod_restart':
        return 'Reviso el reinicio pendiente de ARKNO2, Xainner.';
      default:
        return null;
    }
  }
  switch (tool) {
    case 'restart_server':
      return 'Reiniciar? Claro, pedir es facil. Reviso ARKNO2 y, si cuadra, dejo el aviso corriendo.';
    case 'save_world':
      return 'Voy a guardar ARKNO2. Un momento.';
    case 'start_server':
    case 'stop_server':
      return 'Eso lo decide Xainner o un rol autorizado. Reviso permisos primero.';
    case 'broadcast_server_message':
      return 'Un mensaje para ARKNO2? Lo reviso.';
    case 'check_mod_updates':
      return 'A ver que rompieron ahora. Reviso los mods de ARKNO2.';
    default:
      return null;
  }
}

export function resultForDenial(reason: string, isXainner: boolean): string {
  if (isXainner) return `No pude hacerlo, Xainner: ${reason}. No voy a fingir que salio bien.`;
  return `No. ${reason}. Yo cuido ARKNO2, no hago milagros fuera de mis permisos.`;
}
