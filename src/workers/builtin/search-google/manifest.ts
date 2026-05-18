import type { WorkerManifest } from '../../types';
import { searchGoogle } from './client';

export const searchGoogleWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.search.google',
  name: 'Google Search',
  version: '0.1.0',
  description:
    'Provides Google Custom Search to the assistant and to other workers that need web search.',
  builtIn: true,
  requiredCredentials: [
    { key: 'googleSearchConfigured', label: 'Google Search credentials', settingsTarget: 'health-google' },
  ],
  ownedSettings: [
    {
      key: 'google-search-credentials',
      label: 'Google Search credentials',
      description: 'Local environment values used for Google Custom Search.',
      scope: 'worker',
      storageKey: '.env.GOOGLE_*',
      dashboardTarget: 'config',
    },
  ],
  dashboard: {
    settings: [
      {
        id: 'google-credentials',
        label: 'Google Search credentials',
        description: 'API key and search engine ID for Google Custom Search.',
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
    ],
  },
  jobs: [],
  tools: [
    {
      id: 'web-search',
      workerId: 'core.search.google',
      name: 'webSearch',
      description:
        "Search the web for current information using Google. Use this when you need up-to-date facts, news, or information you don't have.",
      permissions: ['network:google-cse'],
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
      async execute({ query }: { query: string }) {
        const results = await searchGoogle(query);
        if (results.length === 0) {
          return 'No results found.';
        }
        return results
          .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.link}`)
          .join('\n\n');
      },
    },
  ],
};
