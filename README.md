# Rinari — Zomboid Discord Bot

Operador de Discord con LLM para el servidor Project Zomboid `ARKNO2` via Zomboid Control Panel.

## Alcance

- Solo opera `ARKNO2`. Verificacion de identidad del servidor antes de cada mutacion.
- Sin shell, sin SSH, sin Docker, sin RCON arbitrario, sin HTTP generico, sin administracion del panel.
- Allowlist cerrada de endpoints del panel. La politica se aplica en codigo, no en el LLM.

## Arquitectura

```
Discord (discord.js v14, canal 1546326953815048263)
  -> routing + rate limit + typing
  -> Orchestrator (LLM + tools, max 4 rounds / 3 calls)
  -> ToolExecutor (policy check + assert ARKNO2 + mutex lifecycle)
  -> PanelClient (metodos cerrados, Bearer + refresh single-flight)
  -> Zomboid Control Panel http://192.168.0.3:17050
LLM: https://api.xainner.com/v1, model qwen3.8-27b-uncensored
Estado conversacional: SQLite persistente (fallback in-memory)
```

## Tools

| Tool | Acceso |
| --- | --- |
| `get_server_status` | Todos |
| `get_players` | Todos |
| `get_mod_status` | Todos si `ENABLE_MOD_TOOLS=true` |
| `check_mod_updates` | Todos si `ENABLE_MOD_TOOLS=true` |
| `save_world` | Todos si `PUBLIC_SAVE=true`, si no solo privilegiados |
| `restart_server` | Todos si `PUBLIC_RESTART=true` con warning minimo, privilegiados con `0..60` |
| `start_server` | Solo Xainner o rol autorizado |
| `stop_server` | Solo Xainner o rol autorizado (graceful) |
| `broadcast_server_message` | Solo privilegiados si `ENABLE_BROADCAST_TOOL=true` |
| `cancel_pending_mod_restart` | Solo privilegiados si `ENABLE_MOD_TOOLS=true` |

Xainner se reconoce exclusivamente por `message.author.id == XAINNER_USER_ID`.

## Variables de entorno

Ver `.env.example`. Requeridas para arrancar: `DISCORD_TOKEN`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `PANEL_USERNAME`, `PANEL_PASSWORD`.

Panel real verificado: `v1.1.44`, `http://192.168.0.3:17050`, servidor activo `ARKNO2`.

## Cuenta del panel

Crear usuario local `rinari_bot` con rol custom minimo. No usar `technician` por amplitud. Capacidades base: lectura de estado, `players.view`, control de servidor segun perfil. Si `ENABLE_MOD_TOOLS=true`, la cuenta necesita `mods.manage`, pero el bot mantiene allowlist de solo lectura/check y nunca expone escritura de mods. `mods.manage` es sensible porque permite instalar/eliminar mods y editar INI; por eso el codigo bloquea esas rutas aunque el rol las tenga.

## Discord

Intents: `Guilds`, `GuildMessages`, `MessageContent`. Activar `Message Content` en el portal. Solo responde en `DISCORD_CHANNEL_ID`. Ignora DMs, bots, webhooks y otros canales. Usa `allowedMentions: { parse: [] }`.

## Desarrollo

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

## Preflight (solo lectura)

```bash
node dist/preflight.js
```

Ejecuta login, `GET active server`, `GET status`, `GET players` y `GET mod status` si aplica. No ejecuta mutaciones.

## Systemd

Unidad en `deploy/rinari-zomboid.service`. Instalacion:

```bash
sudo useradd -r -s /usr/sbin/nologin rinari-zomboid
sudo mkdir -p /opt/rinari-zomboid-bot
sudo cp -r dist package.json package-lock.json .env /opt/rinari-zomboid-bot/
sudo chmod 600 /opt/rinari-zomboid-bot/.env
sudo cp deploy/rinari-zomboid.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rinari-zomboid.service
```

## Logs

JSON por stdout via journald. Incluye `tool_execution` con tool, requester, autorizacion y duracion. No se loguean tokens ni passwords.

## Troubleshooting

- `401`: refresh/login automatico una vez; si persiste, revisar `PANEL_USERNAME`/`PANEL_PASSWORD`.
- `403`: falta capability en el rol; no subir privilegios automaticamente.
- `409`: operacion lifecycle ya en curso; el mutex local tambien la bloquea.
- `5xx`: fallo real del panel; reportar sin reintentar mutaciones.
- Timeout en mutacion: estado ambiguo; consultar `get_server_status`, no duplicar el POST.

## Actualizacion y rollback

Desplegar por version de git. Rollback: detener unidad, restaurar directorio anterior, `daemon-reload` y arrancar. No reinicia el panel ni ARKNO2 como parte del deploy.

## Security boundaries

`TARGET SERVER = ARKNO2`. Sin shell/SSH/Docker/RCON generico/HTTP generico/file browser/panel administration/server switching/force-stop/wipe/mod deletion/INI writes. Verificacion `activeServer.serverName === ARKNO2` antes de cada mutacion.
