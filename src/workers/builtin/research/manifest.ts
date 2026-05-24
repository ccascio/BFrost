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
  deletable: true,
  requiredDependencies: [
    { key: 'googleSearchConfigured', label: 'Google Web Search', settingsTarget: 'config' },
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
      prompt: {
        editable: true,
        helpText: 'These instructions tell the AI how to turn raw search results into a research note. You can change the tone, focus, or output format — or start from one of the examples below.',
        examples: [
          {
            label: 'Default analyst',
            description: 'Balanced summary with sources — the default style.',
            value: DEFAULT_RESEARCH_PROMPT,
          },
          {
            label: 'Executive brief',
            description: 'One short paragraph per topic — suitable for busy readers.',
            value: `You are a research assistant writing for a busy executive.

For each topic, write exactly one paragraph (3–5 sentences): what happened, why it matters, and one concrete action to consider.

Be direct. No bullet points. No hype. End with a "Sources" section.

Return Markdown only.`,
          },
          {
            label: 'Deep dive',
            description: 'Longer analysis with open questions and implications — good for technical topics.',
            value: `You are a domain expert synthesising web findings into a detailed research note.

For each topic cover:
1. What changed or was discovered
2. Technical or domain-specific implications
3. Second-order effects to watch
4. Open questions and gaps in current understanding
5. Recommended follow-up searches

Cite sources inline. Return Markdown only.`,
          },
        ],
      },
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
