import type { WorkerManifest } from '../../types';
import { getActiveChatContext } from '../../../chat-context';
import { DOCUMENTS_WORKER_ID, searchProjectDocuments } from './store';

export const documentsWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: DOCUMENTS_WORKER_ID,
  name: 'Documents',
  displayName: 'Project Documents',
  version: '0.1.0',
  description: 'Per-project document store the assistant can search to answer from your files.',
  tagline:
    'Upload text and markdown files to a project, then chat with them. The assistant searches only the documents in the project you are working in. Everything stays on your machine.',
  chatPrompts: [
    {
      label: 'Ask about a document',
      description: 'Answer from the files in the current project.',
      prompt: 'Summarise the key points from the documents in this project.',
    },
  ],
  builtIn: true,
  optionalDependencies: [
    { key: 'embeddingModelReachable', label: 'Local embedding model endpoint', settingsTarget: 'system' },
  ],
  dashboard: {
    routes: [
      {
        id: 'documents-files',
        label: 'Documents',
        description: 'Upload, view, and remove the files attached to each project.',
        tab: 'workers',
      },
    ],
  },
  jobs: [],
  tools: [
    {
      id: 'search-documents',
      workerId: DOCUMENTS_WORKER_ID,
      name: 'searchDocuments',
      description:
        "Search the current project's uploaded documents for passages relevant to a query. " +
        'Use this whenever the user asks about, refers to, or wants information from their files. ' +
        'Returns the most relevant excerpts with their source filenames.',
      permissions: ['documents:read'],
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to look for in the project documents.',
          },
        },
        required: ['query'],
      },
      async execute({ query }: { query: string }): Promise<string> {
        const { projectId } = getActiveChatContext();
        if (!projectId) {
          return 'No project is selected, so there are no documents to search. Open or start a chat inside a project that has uploaded files.';
        }
        const matches = await searchProjectDocuments(projectId, query);
        if (matches.length === 0) {
          return 'No relevant content was found in this project\'s documents.';
        }
        return matches.map((match) => `[${match.filename}]\n${match.text}`).join('\n\n---\n\n');
      },
    },
  ],
};
