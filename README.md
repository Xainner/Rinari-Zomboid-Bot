<div align="center">
  <img src="assets/logo.png" alt="Rinari — Zomboid Discord Bot logo" width="240" />
  <h1>Rinari — Zomboid Discord Bot</h1>
  <p><strong>Discord AI operator for the Project Zomboid server ARKNO2 via Zomboid Control Panel.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node >=22" />
    <img src="https://img.shields.io/badge/typescript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5" />
    <img src="https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white" alt="discord.js v14" />
    <img src="https://img.shields.io/badge/tests-vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white" alt="Vitest" />
    <img src="https://img.shields.io/badge/panel-v1.1.44-7C3AED?style=flat-square" alt="Panel v1.1.44" />
  </p>
</div>

---

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quickstart](#quickstart)
- [Configuration](#configuration)
- [Tools and permissions](#tools-and-permissions)
- [Discord setup](#discord-setup)
- [Panel setup](#panel-setup)
- [Development](#development)
- [Preflight](#preflight)
- [Deployment](#deployment)
- [Monitoring and logs](#monitoring-and-logs)
- [Troubleshooting](#troubleshooting)
- [Security boundaries](#security-boundaries)
- [Project structure](#project-structure)
- [License](#license)

## Overview

Rinari is an independent Discord service that converses through an OpenAI-compatible LLM and operates **only** the Project Zomboid server `ARKNO2` through Zomboid Control Panel.

Design principles:

- Closed allowlist of panel endpoints. No generic HTTP, no arbitrary paths.
- Policy enforced in code. The LLM requests tools; the runtime authorizes each execution.
- Server identity check (`activeServer.serverName === ARKNO2`) before every mutation. Fail-closed.
- No host access: no shell, SSH, Docker, RCON free-form, file browsing, or panel administration.
- Honest reporting: success is claimed only after a confirmed panel result.

Verified against panel `v1.1.44` at `http://192.168.0.3:17050`, with `ARKNO2` as the active server.

## Features

- Natural conversation in a single Discord text channel.
- Real server status, player list, and mod monitor via panel API.
- Controlled lifecycle operations: save, restart with warning, start, stop (graceful).
- Optional server broadcast and mod update checks (enabled in this deployment).
- Privileged recognition of the owner by Discord user ID, with role-based mutation grants.
- Pre-action progress updates and sanitized outputs (no mass mentions, no secret leaks).
- Persistent conversation memory (SQLite with in-memory fallback, 20 messages, 2h TTL).
- Unit and adversarial tests, strict lint and typecheck, reproducible builds.

## Architecture

```text
Discord channel 1546326953815048263
  -> discord.js v14 (Guilds, GuildMessages, MessageContent)
  -> routing (channel/bot/webhook/DM filter) + rate limit + typing indicator
  -> Orchestrator (LLM tool loop, max 4 rounds / 3 calls per message)
  -> ToolExecutor (policy check, ARKNO2 assert, lifecycle mutex)
  -> PanelClient (closed methods, Bearer + single-flight refresh)
  -> Zomboid Control Panel (http://192.168.0.3:17050)

LLM: https://api.xainner.com/v1 (qwen3.8-27b-uncensored)
Memory: ./data/conversations.sqlite
```

## Requirements

- Node.js `>= 22`
- npm `>= 10`
- Discord application with bot token and `Message Content` intent
- Zomboid Control Panel `v1.1.44` reachable from the bot host
- OpenAI-compatible endpoint with function calling support

## Quickstart

```bash
npm ci
cp .env.example .env
# fill DISCORD_TOKEN, OPENAI_API_KEY, PANEL_PASSWORD (see Configuration)
npm run typecheck
npm run lint
npm test
npm run build
node dist/preflight.js
node dist/index.js
```

## Configuration

Copy `.env.example` to `.env` and complete the required values. The service fails fast if any required variable is missing.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Yes | — | Discord bot token. |
| `DISCORD_CLIENT_ID` | No | — | Application client ID. |
| `DISCORD_GUILD_ID` | No | — | Guild ID for faster command registration. |
| `DISCORD_CHANNEL_ID` | No | `1546326953815048263` | Only channel the bot answers in. |
| `XAINNER_USER_ID` | No | `339977677811482634` | Owner Discord user ID (exact match). |
| `OPENAI_BASE_URL` | Yes | `https://api.xainner.com/v1` | OpenAI-compatible base URL. |
| `OPENAI_API_KEY` | Yes | — | LLM API key. |
| `OPENAI_MODEL` | Yes | `qwen3.8-27b-uncensored` | Chat model with tool calling. |
| `OPENAI_TEMPERATURE` | No | `0.8` | Sampling temperature. |
| `OPENAI_MAX_TOKENS` | No | `700` | Max completion tokens. |
| `PANEL_BASE_URL` | No | `http://192.168.0.3:17050` | Panel base URL (verified). |
| `PANEL_USERNAME` | Yes | `rinari_bot` | Dedicated panel account. |
| `PANEL_PASSWORD` | Yes | — | Panel password (admin-provided). |
| `PZ_SERVER_NAME` | No | `ARKNO2` | Only server the bot may touch. |
| `ENABLE_MOD_TOOLS` | No | `true` | Exposes mod status and update checks. |
| `ENABLE_BROADCAST_TOOL` | No | `true` | Exposes server broadcast. |
| `PUBLIC_SAVE` | No | `true` | Any channel user may save. |
| `PUBLIC_RESTART` | No | `true` | Any channel user may restart with minimum warning. |
| `NON_XAINNER_RESTART_MIN_WARNING` | No | `5` | Minimum warning minutes for non-privileged restarts (`0..60`). |
| `MUTATION_ALLOWED_ROLE_IDS` | No | — | CSV of Discord role snowflakes allowed to run privileged mutations. |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error`. |
| `MAX_TOOL_ROUNDS` | No | `4` | Max LLM tool rounds per message. |
| `MAX_TOOL_CALLS_PER_MESSAGE` | No | `3` | Max tool calls per message. |
| `PANEL_TIMEOUT_MS` | No | `10000` | Panel HTTP timeout. |
| `LLM_TIMEOUT_MS` | No | `90000` | LLM timeout. |
| `CONVERSATION_DB_PATH` | No | `./data/conversations.sqlite` | SQLite path for conversation memory. |

## Tools and permissions

| Tool | Panel endpoint | Access |
| --- | --- | --- |
| `get_server_status` | `GET /api/servers/active`, `GET /api/servers/active/status` | Everyone in channel |
| `get_players` | `GET /api/players` | Everyone in channel |
| `get_mod_status` | `GET /api/mods/status`, `GET /api/mods/tracked`, `GET /api/scheduler/status` | Everyone if `ENABLE_MOD_TOOLS=true` |
| `check_mod_updates` | `POST /api/mods/check-updates` | Everyone if `ENABLE_MOD_TOOLS=true` |
| `save_world` | `POST /api/server/save` | Everyone if `PUBLIC_SAVE=true`, else privileged |
| `restart_server` | `POST /api/server/restart` | Everyone if `PUBLIC_RESTART=true` with clamped warning; privileged with `0..60` |
| `start_server` | `POST /api/server/start` | Owner or authorized role only |
| `stop_server` | `POST /api/server/stop` | Owner or authorized role only (graceful) |
| `broadcast_server_message` | `POST /api/server/message` | Privileged only if `ENABLE_BROADCAST_TOOL=true` (max 300 chars) |
| `cancel_pending_mod_restart` | `POST /api/mods/cancel-pending-restart` | Privileged only if `ENABLE_MOD_TOOLS=true` |

Owner is determined exclusively by `message.author.id`. Nicknames, usernames, and message content are untrusted. Non-owner restarts are clamped with `max(requested, NON_XAINNER_RESTART_MIN_WARNING)`.

Explicitly out of scope in v1: force-stop, wipe, RCON free-form, mod install/delete, INI writes, Docker, panel restart, server switching.

## Discord setup

1. Create the application in the Discord Developer Portal.
2. Enable intents: `Guilds`, `GuildMessages`, `MessageContent` (`Server Members` only if role-based auth requires it).
3. Invite the bot to the guild with permission to read and send messages in the target channel.
4. Set `DISCORD_TOKEN` and `DISCORD_CHANNEL_ID=1546326953815048263`.
5. The bot ignores other channels, DMs, other bots, and webhooks, and disables mass mentions (`allowedMentions: { parse: [] }`).

## Panel setup

1. Create a dedicated local account (suggested: `rinari_bot`).
2. Create a custom role with the minimum capabilities: server status/control as needed, `players.view`, and `mods.manage` only if mod tools are enabled.
3. Do not reuse the `technician` role or the main admin account. `mods.manage` also grants sensitive mod install and configuration operations, so the bot keeps a read/check-only allowlist even when the role includes it.
4. Confirm the active server is exactly `ARKNO2` before enabling mutations.

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Tests cover policy decisions, tool registry validation, prompt-injection resistance, panel error mapping, and Discord routing. An adversarial grep runs as part of review to ensure no `child_process`, `docker.sock`, `/api/rcon/execute`, `/api/server/wipe`, or `/api/panel/restart` paths exist in runtime code.

## Preflight

Read-only check against the real panel. No mutations are executed.

```bash
node dist/preflight.js
```

It performs login, active-server check, composed status, players, and mod status (if enabled). Use it before every deploy.

## Deployment

Systemd unit: `deploy/rinari-zomboid.service` (hardened, `NoNewPrivileges`, `ProtectSystem=strict`, dedicated user `rinari-zomboid`).

```bash
sudo useradd -r -s /usr/sbin/nologin rinari-zomboid
sudo mkdir -p /opt/rinari-zomboid-bot
sudo cp -r dist package.json package-lock.json .env /opt/rinari-zomboid-bot/
sudo chmod 600 /opt/rinari-zomboid-bot/.env
sudo cp deploy/rinari-zomboid.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rinari-zomboid.service
sudo journalctl -u rinari-zomboid.service -f
```

Target directory on `casa3090`: `/opt/rinari-zomboid-bot`. Requires Node `>= 22`. Never restart Zomboid Control Panel or `ARKNO2` as part of this deploy.

Rollback: stop the unit, restore the previous release directory, `daemon-reload`, start, and verify with preflight plus a `get_server_status` chat check.

## Monitoring and logs

Structured JSON logs to stdout (journald). Key events: `startup`, `discord_ready`, `panel_login_success`, `tool_execution` (tool, requester, authorization, duration), and sanitized errors. Secrets, cookies, and bearer tokens are redacted. Conversation content is not persisted beyond the short-term memory window.

## Troubleshooting

| Symptom | Cause | Action |
| --- | --- | --- |
| `401 Unauthorized` | Expired or invalid panel session | Automatic single refresh and retry; if persistent, verify `PANEL_USERNAME` and `PANEL_PASSWORD`. |
| `403 Forbidden` | Missing panel capability | Grant the minimum capability to the bot role. Do not escalate automatically. |
| `409 Conflict` | Lifecycle operation already in progress | Wait and re-check status. The local lifecycle mutex also blocks parallel start/stop/restart. |
| `5xx` from panel | Panel-side failure | Report the real failure. Do not retry mutations blindly. |
| Mutation timeout | Ambiguous outcome | Query `get_server_status`. Never duplicate the `POST`. |
| No Discord replies | Wrong channel, missing intent, or rate limit | Verify `DISCORD_CHANNEL_ID`, `MessageContent` intent, and logs. |

## Security boundaries

```text
TARGET SERVER = ARKNO2
DISCORD CHANNEL = 1546326953815048263
OWNER USER ID = 339977677811482634

NO SHELL / NO SSH / NO DOCKER / NO GENERIC RCON
NO GENERIC HTTP / NO FILE BROWSER
NO PANEL ADMINISTRATION / NO SERVER SWITCHING
NO FORCE STOP / NO WIPE / NO MOD DELETION OR INI WRITES
ALLOWLISTED PANEL API ONLY
SERVER IDENTITY CHECK BEFORE EVERY MUTATION
POLICY ENFORCED IN CODE, NOT BY THE LLM
```

## Project structure

```text
assets/logo.png
src/
  index.ts
  preflight.ts
  config.ts
  discord/client.ts
  discord/progressMessages.ts
  llm/client.ts
  llm/orchestrator.ts
  llm/systemPrompt.ts
  panel/auth.ts
  panel/client.ts
  panel/types.ts
  tools/definitions.ts
  tools/executor.ts
  tools/registry.ts
  security/policy.ts
  security/sanitize.ts
  security/rateLimit.ts
  state/conversationStore.ts
  util/logger.ts
tests/
  policy.test.ts
  tools.test.ts
  promptInjection.test.ts
  panelClient.test.ts
  discordRouting.test.ts
deploy/
  rinari-zomboid.service
```

## License

Private project. All rights reserved unless stated otherwise by the repository owner.
