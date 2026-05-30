import type { WorkerManifest } from '../../types';
import { queryItems, recentRuns } from './tools';

export const itemsQueryWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.items.query',
  name: 'Items Query',
  displayName: 'Bus & History Inspector',
  version: '0.1.0',
  description:
    'Read-only assistant tools that query the Item Bus and recent scheduler runs so the assistant can answer questions like "what are the latest news?" or "did the research job run today?".',
  tagline:
    'Lets the assistant look up what is in your queue and what your workers have done recently — so chat questions about news, runs, and progress actually get answered.',
  chatPrompts: [
    {
      label: 'Queue summary',
      description: 'Summarize recent Item Bus activity.',
      prompt: 'Show me the newest items in the queue and group them by state.',
    },
    {
      label: 'Needs attention',
      description: 'Find failed, rejected, or stuck work.',
      prompt: 'What queue items or recent runs need my attention?',
    },
    {
      label: 'Run history',
      description: 'Review recent scheduler outcomes.',
      prompt: 'What were the last 10 job runs and did any of them fail?',
    },
  ],
  builtIn: true,
  jobs: [],
  tools: [
    {
      id: 'query-items',
      workerId: 'core.items.query',
      name: 'queryItems',
      description:
        'List items on the BFrost Item Bus. Use this to answer questions about queued news, approved posts, recent publishes, or anything else that lives in the queue. Filter by itemType (e.g. "news.article"), producerWorkerId (e.g. "core.news"), tags, states ("queued", "approved", "posted", "rejected", "failed", "seen"), or by a since timestamp. Returns the newest matching items first.',
      permissions: ['storage:read'],
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          itemType: {
            type: 'string',
            description: 'Single item type to match (e.g. "news.article").',
          },
          itemTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Multiple item types to match (any of).',
          },
          producerWorkerId: {
            type: 'string',
            description: 'Restrict to items produced by this worker id (e.g. "core.news").',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Match items carrying any of these tags.',
          },
          states: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Match items whose state is in this list. Allowed: queued, approved, posted, rejected, failed, seen.',
          },
          since: {
            type: 'string',
            description: 'ISO-8601 timestamp. Only items added at or after this time are returned.',
          },
          limit: {
            type: 'number',
            description: 'Maximum items to return (default 10, max 50).',
          },
        },
      },
      async execute(input: Record<string, unknown>) {
        return queryItems(input as Parameters<typeof queryItems>[0]);
      },
    },
    {
      id: 'recent-runs',
      workerId: 'core.items.query',
      name: 'recentRuns',
      description:
        'List recent scheduler run records — when each job last ran, whether it succeeded, how long it took, and any summary line. Use this to answer questions like "did the news digest run today?" or "what was the last research run?".',
      permissions: ['storage:read'],
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          jobName: {
            type: 'string',
            description: 'Restrict to runs of this job id (e.g. "news-digest", "personal-research").',
          },
          status: {
            type: 'string',
            description: 'Restrict to runs with this status: running, success, error, skipped.',
          },
          limit: {
            type: 'number',
            description: 'Maximum runs to return (default 10, max 50).',
          },
        },
      },
      async execute(input: Record<string, unknown>) {
        return recentRuns(input as Parameters<typeof recentRuns>[0]);
      },
    },
  ],
};
