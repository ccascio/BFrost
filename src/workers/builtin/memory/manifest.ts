import type { WorkerManifest } from '../../types';
import { saveMemory, searchMemory } from './store';

export const memoryWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.memory',
  name: 'Memory',
  version: '0.1.0',
  description: 'Long-term assistant memory backed by local embeddings.',
  builtIn: true,
  // The embedding endpoint is *needed* when saveMemory / recallMemory actually run, but it
  // does not have to be reachable for the worker to be enabled and the assistant tools to
  // be registered — runtime calls surface a clear error instead. Declaring it as optional
  // keeps the Health tab informative without blocking the worker or its tools.
  optionalDependencies: [
    { key: 'embeddingModelReachable', label: 'Local embedding model endpoint', settingsTarget: 'system' },
  ],
  jobs: [],
  tools: [
    {
      id: 'save-memory',
      workerId: 'core.memory',
      name: 'saveMemory',
      description:
        'Save a detailed summary of the current conversation to long-term memory. Use this when the user explicitly asks to save or remember something.',
      permissions: ['memory:write'],
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description:
              'A detailed summary of the conversation or information to remember. Include key facts, decisions, and context.',
          },
        },
        required: ['summary'],
      },
      async execute({ summary }: { summary: string }) {
        await saveMemory(summary);
        return 'Memory saved successfully.';
      },
    },
    {
      id: 'recall-memory',
      workerId: 'core.memory',
      name: 'recallMemory',
      description:
        'Search long-term memory for previously saved information. Use this when the user asks to recall, remember, or retrieve something from past conversations.',
      permissions: ['memory:read'],
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The topic or question to search for in memory.',
          },
        },
        required: ['query'],
      },
      async execute({ query }: { query: string }) {
        const results = await searchMemory(query);
        if (results.length === 0) {
          return 'No relevant memories found.';
        }
        return `Found memories:\n${results.join('\n')}`;
      },
    },
  ],
};
