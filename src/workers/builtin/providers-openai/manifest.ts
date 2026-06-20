import type { WorkerManifest } from '../../types';

export const openaiProviderWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.providers.openai',
  name: 'OpenAI Provider',
  displayName: 'OpenAI (cloud)',
  version: '0.1.0',
  description:
    'Serves OpenAI chat models through either the OpenAI API or a local Codex ChatGPT subscription login.',
  tagline:
    'Use your OpenAI account to power BFrost. Choose API billing with an API key, or subscription access through your local Codex login.',
  chatPrompts: [
    {
      label: 'OpenAI health',
      description: 'Check whether the cloud provider is configured.',
      prompt: 'Is the OpenAI provider configured and available for chat?',
    },
  ],
  builtIn: true,
  kind: 'provider',
  requiredCredentials: [
    { key: 'openaiConfigured', label: 'OpenAI provider access', settingsTarget: 'system' },
  ],
  dashboard: {
    settings: [
      {
        id: 'credentials',
        label: 'Provider access',
        description:
          'Choose OpenAI API key billing or ChatGPT subscription access through your local Codex ChatGPT login. API keys are stored in your local .env file.',
        path: '/api/workers/providers-openai/credentials',
        fields: [
          {
            type: 'select' as const,
            key: 'authMode',
            label: 'Access mode',
            defaultValue: 'api',
            seedPath: 'core.providers.openai.authMode',
            options: [
              { label: 'OpenAI API key', value: 'api' },
              { label: 'ChatGPT subscription', value: 'subscription' },
            ],
            helpText:
              'Subscription mode uses OAuth credentials from `codex login` and the ChatGPT Codex Responses transport.',
          },
          {
            type: 'secret-reference' as const,
            key: 'apiKey',
            label: 'OpenAI API key',
            defaultValue: '',
            helpText: 'Required for API-key mode. Starts with sk-. Leave blank to keep the current key.',
          },
          {
            type: 'text' as const,
            key: 'codexCliModel',
            label: 'ChatGPT subscription model',
            defaultValue: 'gpt-5.4-mini',
            seedPath: 'core.providers.openai.codexCliModel',
            helpText: 'Used only in subscription mode. Pick a model your ChatGPT/Codex subscription can access.',
          },
          {
            type: 'action' as const,
            key: 'chatgptLogin',
            label: 'ChatGPT subscription login',
            buttonLabel: 'Log in with ChatGPT',
            actionPath: '/api/workers/providers-openai/oauth/start',
            method: 'POST' as const,
            openInPopup: true,
            helpText: 'Opens OpenAI login in a browser popup and saves the returned OAuth session locally for subscription mode.',
          },
        ],
      },
    ],
  },
  jobs: [],
  providers: [
    {
      id: 'openai',
      workerId: 'core.providers.openai',
      label: 'OpenAI',
      description: 'OpenAI API or ChatGPT subscription through Codex OAuth.',
      capabilities: {
        chat: true,
        embeddings: true,
        vision: false,
        localRuntime: false,
      },
      defaultModels: [
        {
          alias: 'gpt-5.5',
          id: 'gpt-5.5',
          label: 'GPT-5.5',
        },
        {
          alias: 'gpt-5.4-mini',
          id: 'gpt-5.4-mini',
          label: 'GPT-5.4 mini',
        },
      ],
    },
  ],
};
