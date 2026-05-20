# `core.channels.discord`

Send-only Discord channel worker for operator notifications. This first version posts to a
specific text channel via the Discord HTTP API. Two-way conversation (receiving messages
through the gateway WebSocket) is not implemented yet — Telegram remains the recommended
two-way channel for now.

## What it provides

- A `ChannelAdapter` (`providerId: 'discord'`) that implements `notifyOperator(text)` by
  POSTing to `channels/<channelId>/messages` with `Authorization: Bot <token>`.
- `start()` / `stop()` are no-ops — there is no gateway connection to maintain.
- Long messages are chunked at 2,000 characters (the Discord per-message limit).

## Credentials

Stored under the worker's own KV namespace (`worker.core.channels.discord.credentials`):

- `botToken` — from `discord.com/developers/applications` → your app → Bot → Reset Token.
- `channelId` — numeric channel ID. In Discord, enable **User Settings → Advanced →
  Developer Mode**, then right-click a channel → **Copy Channel ID**.

Falls back to `DISCORD_BOT_TOKEN` / `DISCORD_CHANNEL_ID` env vars when the KV is empty.

## API routes

All under `/api/workers/discord/`:

- `POST settings` — save `discordBotToken` and/or `discordChannelId`.
- `POST verify-token` — non-destructive token check; returns the bot identity on success.
- `GET status` — `{tokenConfigured, channelConfigured, channelId, bot, errorMessage}`.
- `POST test-message` — sends "BFrost test message — your Discord channel is connected and reachable. ✅" to the configured channel.

## Operational caveats

- The bot must be **invited to the server** that contains the target channel and have the
  **Send Messages** permission. Discord returns HTTP 403 otherwise.
- Bots can DM users only when they share a server. Using a channel ID rather than a user ID
  sidesteps that limitation and matches how most operators run notification bots.
- The test endpoint surfaces 403 / 404 with friendly hints; other HTTP errors include the
  raw response body so misconfiguration is easy to diagnose.
