import { generateText } from 'ai';
import { z } from 'zod';
import type { AdminApiRoute } from '../../../admin-route';
import { BadRequestError } from '../../../admin-route';
import { recordEventSafe } from '../../../event-log';
import { getProject } from '../../../projects';
import { getChatModel } from '../../../llm';
import { getDefaultModel } from '../../../config';
import { DOCUMENTS_WORKER_ID, addFile, deleteFile, listFiles, listFileChunks, reconcileOrphans } from './store';

const summaryCache = new Map<string, string>();

// Text/markdown only — binary extraction (PDF/Word) is intentionally out of scope.
const ALLOWED_EXTENSIONS = ['.txt', '.md', '.markdown', '.text'];
// Decoded content cap. Base64-in-JSON inflates ~33%, so this stays under the
// admin server's 1 MB request-body limit with headroom.
const MAX_CONTENT_BYTES = 600 * 1024;

const UploadBodySchema = z.object({
  projectId: z.string().min(1).max(120),
  filename: z.string().min(1).max(200),
  contentBase64: z.string().min(1),
}).strict();

const DeleteBodySchema = z.object({
  fileId: z.string().min(1).max(120),
}).strict();

function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export const documentsApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/documents/upload',
    workerIds: [DOCUMENTS_WORKER_ID],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, UploadBodySchema);
      if (!getProject(body.projectId)) {
        throw new BadRequestError('Unknown project. Create or select a project before uploading.');
      }
      if (!hasAllowedExtension(body.filename)) {
        throw new BadRequestError(`Only text/markdown files are supported (${ALLOWED_EXTENSIONS.join(', ')}).`);
      }
      const buffer = Buffer.from(body.contentBase64, 'base64');
      if (buffer.length === 0) {
        throw new BadRequestError('Uploaded file is empty.');
      }
      if (buffer.length > MAX_CONTENT_BYTES) {
        throw new BadRequestError(`File is too large; limit is ${Math.floor(MAX_CONTENT_BYTES / 1024)} KB of text.`);
      }
      const content = buffer.toString('utf8');
      const file = await addFile({ projectId: body.projectId, filename: body.filename, content });
      await recordEventSafe({
        category: 'worker',
        action: 'document_uploaded',
        summary: `Document "${file.filename}" added to a project.`,
        metadata: { workerId: DOCUMENTS_WORKER_ID, projectId: body.projectId, chunkCount: file.chunkCount },
      });
      return { status: 201, body: { file } };
    },
  },
  {
    method: 'POST',
    path: '/api/documents/delete',
    workerIds: [DOCUMENTS_WORKER_ID],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, DeleteBodySchema);
      const removed = await deleteFile(body.fileId);
      if (!removed) throw new BadRequestError('Document not found.');
      return { status: 200, body: { ok: true } };
    },
  },
  {
    method: 'GET',
    path: '/api/documents/list',
    workerIds: [DOCUMENTS_WORKER_ID],
    async handle({ url }) {
      const projectId = url.searchParams.get('projectId');
      if (!projectId) throw new BadRequestError('projectId query parameter is required.');
      // Opportunistic cleanup of files left by deleted projects.
      await reconcileOrphans();
      const files = await listFiles(projectId);
      return { status: 200, body: { files } };
    },
  },
  {
    method: 'GET',
    path: '/api/documents/chunks',
    workerIds: [DOCUMENTS_WORKER_ID],
    async handle({ url }) {
      const fileId = url.searchParams.get('fileId');
      if (!fileId) throw new BadRequestError('fileId query parameter is required.');
      const chunks = await listFileChunks(fileId);
      return { status: 200, body: { chunks } };
    },
  },
  {
    method: 'POST',
    path: '/api/documents/summarize',
    workerIds: [DOCUMENTS_WORKER_ID],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, z.object({ fileId: z.string().min(1).max(120) }).strict());
      const cached = summaryCache.get(body.fileId);
      if (cached) return { status: 200, body: { summary: cached } };

      const chunks = await listFileChunks(body.fileId);
      if (chunks.length === 0) throw new BadRequestError('File not found or has no content.');

      // Use first chunks up to ~4000 chars as context.
      let context = '';
      for (const chunk of chunks) {
        if (context.length + chunk.text.length > 4000) break;
        context += (context ? '\n\n' : '') + chunk.text;
      }

      const modelOption = getDefaultModel();
      const { text } = await generateText({
        model: getChatModel(modelOption),
        system: 'You are a document analysis assistant. Be concise and factual.',
        prompt: `/no_think\nAnalyze this document and respond with:\n1. A 2–3 sentence summary of what it covers.\n2. A bullet list of the main topics or key points.\n\nDocument:\n${context}`,
        timeout: 60000,
      });

      summaryCache.set(body.fileId, text);
      return { status: 200, body: { summary: text } };
    },
  },
];
