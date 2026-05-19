import {
  DEFAULT_PERSONAL_RESEARCH_PARAMS,
  DEFAULT_RESEARCH_PROMPT,
  PersonalResearchParamsSchema,
  runPersonalResearch,
} from './job';
import type { WorkerManifest } from '../../types';

// This worker is a settings-backed content generator: the Research tab owns
// topics and notes today, while the job manifest exposes runtime knobs.
export const researchWorker: WorkerManifest = {
  id: 'core.research',
  name: 'Research',
  displayName: 'Research Notes',
  version: '0.1.0',
  description: 'Creates durable Markdown research notes from configured topics.',
  tagline: 'Writes a Markdown research note on each topic you care about, on a schedule. Notes are saved locally so you can read, edit, and keep them.',
  builtIn: true,
  requiredCredentials: [
    { key: 'googleSearchConfigured', label: 'Google Search credentials', settingsTarget: 'health-google' },
  ],
  optionalDependencies: [
    { key: 'sqliteCli', label: 'SQLite CLI', settingsTarget: 'health-dependencies' },
  ],
  ownedSettings: [
    {
      key: 'personal-research-job',
      label: 'Personal research schedule',
      description: 'Cron, model, prompt, and parameter settings for the personal research job.',
      scope: 'job',
      storageKey: 'admin.settings.jobs.personal-research',
      dashboardTarget: 'jobs',
    },
    {
      key: 'google-search-credentials',
      label: 'Google Search credentials',
      description: 'Local environment values used by the Research worker for Google Custom Search.',
      scope: 'worker',
      storageKey: '.env.GOOGLE_*',
      dashboardTarget: 'config',
    },
    {
      key: 'research-topics',
      label: 'Research topics',
      description: 'Topics selected in the Research tab and consumed by the research job.',
      scope: 'worker',
      storageKey: 'research.settings',
      dashboardTarget: 'research',
    },
    {
      key: 'research-notes',
      label: 'Research notes index',
      description: 'Generated research note metadata retained for dashboard history.',
      scope: 'worker',
      storageKey: 'research.notes',
      dashboardTarget: 'research',
    },
  ],
  dashboard: {
    settings: [
      {
        id: 'google-credentials',
        label: 'Google Search credentials',
        description: 'API key and search engine ID used by the Research worker.',
        tab: 'config',
        path: '/api/google-credentials',
        fields: [
          {
            key: 'googleApiKey',
            label: 'Google API key',
            type: 'secret-reference',
            defaultValue: '',
            placeholder: 'Configured in local .env',
            helpText: 'Stored as GOOGLE_API_KEY. Leave blank to keep the current value.',
          },
          {
            key: 'googleSearchEngineId',
            label: 'Search engine ID',
            type: 'text',
            defaultValue: '',
            helpText: 'Stored as GOOGLE_SEARCH_ENGINE_ID. Leave blank to keep the current value.',
          },
        ],
      },
      {
        id: 'research-topics',
        label: 'Research topics',
        description: 'Dashboard-managed topics used by the personal research job.',
        tab: 'research',
        path: '/api/research/settings',
      },
    ],
    routes: [
      {
        id: 'research-notes',
        label: 'Research notes',
        description: 'Generated Markdown notes and recent research events.',
        tab: 'research',
        path: '/api/dashboard#research',
      },
    ],
  },
  jobs: [
    {
      id: 'personal-research',
      workerId: 'core.research',
      label: 'Personal Research',
      description: 'Searches configured topics and writes concise research notes.',
      defaultEnabled: false,
      defaultCron: '0 7 * * 1',
      defaultModelAlias: '',
      approvalRequiredDefault: false,
      approvalRequiredEditable: false,
      defaultPrompt: DEFAULT_RESEARCH_PROMPT,
      prompt: { editable: true },
      paramsSchema: PersonalResearchParamsSchema,
      defaultParams: DEFAULT_PERSONAL_RESEARCH_PARAMS,
      dashboardFields: [
        { key: 'maxTopics', label: 'Max topics', type: 'number', defaultValue: DEFAULT_PERSONAL_RESEARCH_PARAMS.maxTopics, min: 1, max: 20 },
        { key: 'resultsPerTopic', label: 'Results per topic', type: 'number', defaultValue: DEFAULT_PERSONAL_RESEARCH_PARAMS.resultsPerTopic, min: 1, max: 20 },
        { key: 'dateRestrict', label: 'Date restrict', type: 'text', defaultValue: DEFAULT_PERSONAL_RESEARCH_PARAMS.dateRestrict },
      ],
      run: (modelId, params) => runPersonalResearch(modelId, PersonalResearchParamsSchema.parse(params ?? {})),
    },
  ],
};
