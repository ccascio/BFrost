import type { WorkerManifest } from '../../types';

export const telegramChannelWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.channels.telegram',
  name: 'Telegram Channel',
  displayName: 'Telegram',
  version: '0.1.0',
  description: 'Reach the BFrost assistant from a Telegram bot.',
  tagline: 'Chat with your BFrost assistant from Telegram — text, voice notes, and photos all work.',
  builtIn: true,
  kind: 'channel',
  requiredCredentials: [
    { key: 'telegramConfigured', label: 'Telegram bot token', settingsTarget: 'system' },
  ],
  ownedSettings: [
    {
      key: 'telegram-credentials',
      label: 'Telegram credentials',
      description: 'Bot token and allowed user id.',
      scope: 'global',
      storageKey: 'env:TELEGRAM_BOT_TOKEN,TELEGRAM_ALLOWED_USER_ID',
      dashboardTarget: 'system',
    },
  ],
  jobs: [],
  dashboard: {
    settings: [
      {
        id: 'telegram-credentials',
        label: 'Telegram credentials',
        description: 'Bot token and allowed user ID.',
        tab: 'config',
        path: '/api/telegram-settings',
        fields: [
          {
            key: 'telegramBotToken',
            label: 'Bot token',
            type: 'secret-reference' as const,
            defaultValue: '',
            placeholder: '123456789:ABCDEF...',
            helpText: 'Telegram bot token from @BotFather. Leave blank to keep the current value.',
          },
          {
            key: 'allowedUserId',
            label: 'Allowed user ID',
            type: 'text' as const,
            defaultValue: '',
            helpText: 'Your numeric Telegram user ID (find it via @userinfobot). Only this user can interact with the bot.',
          },
        ],
      },
    ],
  },
  channels: [
    {
      id: 'telegram',
      workerId: 'core.channels.telegram',
      label: 'Telegram',
      description: 'Telegram bot adapter — text, photo, and voice messages.',
      capabilities: {
        text: true,
        image: true,
        audio: true,
        files: false,
        markdown: true,
        buttons: false,
      },
    },
  ],
};
