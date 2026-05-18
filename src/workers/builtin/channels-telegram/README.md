# `core.channels.telegram`

Reach the BFrost assistant from a Telegram bot. Reference implementation of a **channel worker** — declares capability flags, owns its lifecycle, and registers itself with `notifyOperator` so other workers can reach the operator without importing Telegraf.

## Capabilities

- Text, markdown, buttons. No images, audio, or files today.

## Lifecycle

- `start(ctx)` — boots the Telegram bot via Telegraf, wires the assistant.
- `stop()` — cleanly closes the bot session.
- `isConfigured()` — true when `TELEGRAM_BOT_TOKEN` and the allowed user id are present.
- `notifyOperator(message)` — used by `src/cron.ts` and any worker that wants to surface a notification.

## Settings

- **Telegram channel** — bot token and allowed user id. Route owned by this worker (`/api/telegram-settings`); the request schema lives next to the route.

## Operational notes

- Disabling this worker stops the Telegram bot cleanly. The rest of BFrost continues to run; the dashboard chat is unaffected because it is a separate channel surface (currently in core, planned to migrate to `core.channels.dashboard`).
- Per-worker secrets (`TELEGRAM_BOT_TOKEN`) still go through `src/config.ts` today — the migration to fully worker-owned secrets depends on the permissioned action runtime (Workstream 5).
