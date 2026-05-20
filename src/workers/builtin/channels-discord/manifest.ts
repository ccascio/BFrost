import type { WorkerManifest } from '../../types';

export const discordChannelWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.channels.discord',
  name: 'Discord Channel',
  displayName: 'Discord',
  version: '0.1.0',
  description:
    'Operator notifications to a Discord channel. Send-only in this version — receives messages is not yet implemented.',
  tagline:
    'Have BFrost ping a Discord channel when a job runs, fails, or needs your attention.',
  builtIn: true,
  kind: 'channel',
  requiredCredentials: [
    { key: 'discordConfigured', label: 'Discord bot token + channel ID', settingsTarget: 'config' },
  ],
  ownedSettings: [
    {
      key: 'discord-credentials',
      label: 'Discord credentials',
      description: 'Bot token and operator channel ID.',
      scope: 'global',
      storageKey: 'kv:core.channels.discord.credentials',
      dashboardTarget: 'config',
    },
  ],
  jobs: [],
  dashboard: {
    settings: [
      {
        id: 'discord-credentials',
        label: 'Discord credentials',
        description: 'Bot token and channel ID where BFrost posts operator notifications.',
        tab: 'config',
        path: '/api/workers/discord/settings',
        fields: [
          {
            key: 'discordBotToken',
            label: 'Bot token',
            type: 'secret-reference' as const,
            defaultValue: '',
            placeholder: 'MTAxNjY3...',
            helpText: 'Bot token from your Discord application. Leave blank to keep the current value.',
          },
          {
            key: 'discordChannelId',
            label: 'Channel ID',
            type: 'text' as const,
            defaultValue: '',
            helpText: 'Numeric channel ID. Enable Developer Mode in Discord, then right-click the channel → Copy Channel ID.',
          },
        ],
      },
    ],
  },
  channels: [
    {
      id: 'discord',
      workerId: 'core.channels.discord',
      label: 'Discord',
      description: 'Discord webhook-style channel adapter — sends operator notifications via the Discord HTTP API.',
      capabilities: {
        text: true,
        image: false,
        audio: false,
        files: false,
        markdown: true,
        buttons: false,
      },
    },
  ],
};
