import type { WorkerJobDashboardField, WorkerManifest } from '../../types';
import { PI_COMPATIBLE_PROVIDERS, PI_COMPATIBLE_WORKER_ID } from './catalog';

interface ProviderAuthTemplate {
  groupId: string;
  providerLabel: string;
  description?: string;
  apiKey: {
    key: string;
    envVar: string;
    helpText?: string;
  };
  authMode?: {
    key: string;
    seedPath: string;
    apiLabel: string;
    subscriptionLabel: string;
    helpText: string;
  };
  subscriptionAction?: {
    key: string;
    label: string;
    buttonLabel: string;
    actionPath: string;
    enabledWhen?: { field: string; equals: string };
    disabledReason?: string;
    helpText: string;
  };
  subscriptionModel?: {
    key: string;
    label: string;
    defaultValue: string;
    seedPath: string;
    helpText: string;
  };
}

function providerAuthFields(template: ProviderAuthTemplate): WorkerJobDashboardField[] {
  const fields: WorkerJobDashboardField[] = [];
  if (template.authMode) {
    fields.push({
      type: 'select' as const,
      key: template.authMode.key,
      label: `${template.providerLabel} access mode`,
      group: template.groupId,
      defaultValue: 'api',
      seedPath: template.authMode.seedPath,
      options: [
        { label: template.authMode.apiLabel, value: 'api' },
        { label: template.authMode.subscriptionLabel, value: 'subscription' },
      ],
      helpText: template.authMode.helpText,
    });
  }
  fields.push({
    type: 'action' as const,
    key: template.subscriptionAction?.key ?? `${template.apiKey.key}SubscriptionLogin`,
    label: template.subscriptionAction?.label ?? `${template.providerLabel} subscription login`,
    group: template.groupId,
    buttonLabel: template.subscriptionAction?.buttonLabel ?? 'Subscription unavailable',
    actionPath: template.subscriptionAction?.actionPath ?? '/api/workers/providers-pi-compatible/credentials',
    method: 'POST' as const,
    openInPopup: Boolean(template.subscriptionAction),
    enabledWhen: template.subscriptionAction?.enabledWhen,
    disabled: !template.subscriptionAction,
    disabledReason: template.subscriptionAction
      ? template.subscriptionAction.disabledReason
      : 'BFrost currently supports this provider through API-key auth only.',
    helpText: template.subscriptionAction?.helpText ?? 'No subscription login workflow is available for this provider.',
  });
  fields.push({
    type: 'secret-reference' as const,
    key: template.apiKey.key,
    label: `${template.providerLabel} API key`,
    group: template.groupId,
    defaultValue: '',
    helpText: template.apiKey.helpText ?? `Stored as ${template.apiKey.envVar}. Leave blank to keep the current key.`,
  });
  if (template.subscriptionModel) {
    fields.push({
      type: 'text' as const,
      key: template.subscriptionModel.key,
      label: template.subscriptionModel.label,
      group: template.groupId,
      defaultValue: template.subscriptionModel.defaultValue,
      seedPath: template.subscriptionModel.seedPath,
      helpText: template.subscriptionModel.helpText,
    });
  }
  return fields;
}

const firstPartyProviderFields: WorkerJobDashboardField[] = [
  ...providerAuthFields({
    groupId: 'openai',
    providerLabel: 'OpenAI',
    description: 'OpenAI API key billing or ChatGPT subscription login.',
    apiKey: {
      key: 'openaiApiKey',
      envVar: 'OPENAI_API_KEY',
      helpText: 'Required for API-key mode. Starts with sk-. Leave blank to keep the current key.',
    },
    authMode: {
      key: 'openaiAuthMode',
      seedPath: 'core.providers.pi-compatible.openai.authMode',
      apiLabel: 'OpenAI API key',
      subscriptionLabel: 'ChatGPT subscription',
      helpText: 'Choose direct OpenAI API billing or a local ChatGPT subscription login.',
    },
    subscriptionAction: {
      key: 'openaiSubscriptionLogin',
      label: 'OpenAI subscription login',
      buttonLabel: 'Log in with ChatGPT',
      actionPath: '/api/workers/providers-openai/oauth/start',
      enabledWhen: { field: 'openaiAuthMode', equals: 'subscription' },
      disabledReason: 'Switch OpenAI access mode to ChatGPT subscription to log in.',
      helpText: 'Opens OpenAI login in a browser popup and saves the returned OAuth session locally.',
    },
    subscriptionModel: {
      key: 'openaiSubscriptionModel',
      label: 'OpenAI subscription model',
      defaultValue: 'gpt-5.4-mini',
      seedPath: 'core.providers.pi-compatible.openai.codexCliModel',
      helpText: 'Used only in subscription mode. Pick a model your ChatGPT/Codex subscription can access.',
    },
  }),
  ...providerAuthFields({
    groupId: 'anthropic',
    providerLabel: 'Anthropic',
    description: 'Anthropic API key billing or Claude subscription login.',
    apiKey: {
      key: 'anthropicApiKey',
      envVar: 'ANTHROPIC_API_KEY',
      helpText: 'Required for API-key mode. Starts with sk-ant-. Leave blank to keep the current key.',
    },
    authMode: {
      key: 'anthropicAuthMode',
      seedPath: 'core.providers.pi-compatible.anthropic.authMode',
      apiLabel: 'Anthropic API key',
      subscriptionLabel: 'Claude subscription login',
      helpText: 'Choose direct Anthropic API billing or a local Claude subscription login.',
    },
    subscriptionAction: {
      key: 'anthropicSubscriptionLogin',
      label: 'Anthropic subscription login',
      buttonLabel: 'Log in with Claude',
      actionPath: '/api/workers/providers-anthropic/oauth/start',
      enabledWhen: { field: 'anthropicAuthMode', equals: 'subscription' },
      disabledReason: 'Switch Anthropic access mode to Claude subscription login to log in.',
      helpText: 'Opens Claude login in a browser popup and saves the returned OAuth session locally.',
    },
    subscriptionModel: {
      key: 'anthropicSubscriptionModel',
      label: 'Anthropic subscription model',
      defaultValue: 'claude-sonnet-4-6',
      seedPath: 'core.providers.pi-compatible.anthropic.subscriptionModel',
      helpText: 'Used only in subscription mode. Pick a Claude model your account can access.',
    },
  }),
];

const providerKeyFields: WorkerJobDashboardField[] = PI_COMPATIBLE_PROVIDERS.flatMap((provider) =>
  providerAuthFields({
    groupId: provider.id,
    providerLabel: provider.label,
    description: provider.description,
    apiKey: {
      key: provider.apiKeySettingKey,
      envVar: provider.envVar,
    },
  }),
);

const providerFieldGroups = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'OpenAI API key billing or ChatGPT subscription login.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Anthropic API key billing or Claude subscription login.',
  },
  ...PI_COMPATIBLE_PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    description: provider.description,
  })),
];

export const piCompatibleProviderWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: PI_COMPATIBLE_WORKER_ID,
  name: 'Pi-compatible Providers',
  displayName: 'LLM Providers',
  version: '0.1.0',
  description:
    'Configures cloud LLM providers while keeping each provider behind BFrost provider adapters.',
  tagline:
    'Manage API keys and subscription logins for cloud LLM providers in one place.',
  builtIn: true,
  kind: 'provider',
  settingsOnly: true,
  dashboard: {
    settings: [
      {
        id: 'credentials',
        label: 'Provider access',
        description:
          'Configure LLM provider API keys and subscription logins. Secrets are stored locally on this machine.',
        path: '/api/workers/providers-pi-compatible/credentials',
        fieldGroups: providerFieldGroups,
        fields: [
          ...firstPartyProviderFields,
          ...providerKeyFields,
          {
            type: 'text' as const,
            key: 'cloudflareAccountId',
            label: 'Cloudflare account ID',
            group: 'cloudflare-workers-ai',
            defaultValue: '',
            seedPath: `${PI_COMPATIBLE_WORKER_ID}.cloudflareAccountId`,
            helpText: 'Required only for Cloudflare Workers AI. Stored as CLOUDFLARE_ACCOUNT_ID.',
          },
        ],
      },
    ],
  },
  jobs: [],
  providers: PI_COMPATIBLE_PROVIDERS.map((provider) => ({
    id: provider.id,
    workerId: PI_COMPATIBLE_WORKER_ID,
    label: provider.label,
    description: provider.description,
    capabilities: {
      chat: true,
      embeddings: false,
      vision: false,
      localRuntime: false,
    },
    defaultModels: provider.defaultModels,
  })),
};
