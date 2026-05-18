import type { WorkerManifest } from '../../types';
import { fetchArticle } from './client';

export const articleFetchWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.article-fetch',
  name: 'Article Fetch',
  version: '0.1.0',
  description:
    'Fetches and extracts readable article content from a URL. Used by the assistant and by other workers that need page bodies.',
  builtIn: true,
  jobs: [],
  tools: [
    {
      id: 'fetch-article',
      workerId: 'core.article-fetch',
      name: 'fetchArticle',
      description:
        'Fetch the readable body of an article at a URL. Use this when you need the contents of a specific page rather than a search snippet.',
      permissions: ['network:http-get'],
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The article URL to fetch.' },
        },
        required: ['url'],
      },
      async execute({ url }: { url: string }) {
        const result = await fetchArticle(url);
        if (!result.fetched) {
          return `Could not fetch article: ${result.error ?? 'unknown error'}`;
        }
        return [
          `Title: ${result.title || '(none)'}`,
          `URL: ${result.finalUrl}`,
          result.description ? `Summary: ${result.description}` : '',
          '',
          result.content,
        ]
          .filter(Boolean)
          .join('\n');
      },
    },
  ],
};
