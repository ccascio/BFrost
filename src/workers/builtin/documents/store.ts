import { randomUUID } from 'crypto';
import { openWorkerDb, type WorkerTableHandle } from '../../db';
import { embedText } from '../../../embeddings';
import { listProjectIds } from '../../../projects';

/**
 * Per-project document store for the documents worker. Files are plain text /
 * markdown (binary extraction is intentionally out of scope); each file is split
 * into chunks, and — when an embedding model is configured — every chunk carries
 * its vector and the embed model id. Retrieval is hybrid: semantic cosine over
 * chunks embedded with the *current* model, falling back to keyword matching for
 * everything else (or when no embed model is available). All rows are tagged with
 * `project_id` so retrieval is always scoped to the active project.
 */

export const DOCUMENTS_WORKER_ID = 'core.documents';
const CHUNK_TARGET_CHARS = 1200;
const DEFAULT_TOP_K = 5;

export interface DocumentFile {
  id: string;
  projectId: string;
  filename: string;
  size: number;
  chunkCount: number;
  createdAt: string;
}

interface FileRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  filename: string;
  size: number;
  created_at: string;
}

interface ChunkRow extends Record<string, unknown> {
  id: string;
  file_id: string;
  project_id: string;
  ordinal: number;
  text: string;
  embedding: string | null;
  embed_model: string | null;
}

let filesTable: WorkerTableHandle<FileRow> | null = null;
let chunksTable: WorkerTableHandle<ChunkRow> | null = null;

async function tables(): Promise<{ files: WorkerTableHandle<FileRow>; chunks: WorkerTableHandle<ChunkRow> }> {
  if (filesTable && chunksTable) return { files: filesTable, chunks: chunksTable };
  const db = await openWorkerDb(DOCUMENTS_WORKER_ID);
  filesTable = await db.defineTable<FileRow>('files', {
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'project_id', type: 'TEXT', notNull: true },
      { name: 'filename', type: 'TEXT', notNull: true },
      { name: 'size', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'created_at', type: 'TEXT', notNull: true },
    ],
    indexes: [{ name: 'project', columns: ['project_id'] }],
  });
  chunksTable = await db.defineTable<ChunkRow>('chunks', {
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'file_id', type: 'TEXT', notNull: true },
      { name: 'project_id', type: 'TEXT', notNull: true },
      { name: 'ordinal', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'text', type: 'TEXT', notNull: true },
      { name: 'embedding', type: 'TEXT' },
      { name: 'embed_model', type: 'TEXT' },
    ],
    indexes: [
      { name: 'project', columns: ['project_id'] },
      { name: 'file', columns: ['file_id'] },
    ],
  });
  return { files: filesTable, chunks: chunksTable };
}

/** Split text into ~CHUNK_TARGET_CHARS windows on paragraph boundaries. */
export function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > CHUNK_TARGET_CHARS) {
      chunks.push(current);
      current = '';
    }
    if (paragraph.length > CHUNK_TARGET_CHARS) {
      // A single oversized paragraph is hard-split so no chunk is unbounded.
      for (let i = 0; i < paragraph.length; i += CHUNK_TARGET_CHARS) {
        chunks.push(paragraph.slice(i, i + CHUNK_TARGET_CHARS));
      }
      continue;
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Embed a string, returning null (not throwing) when no embed model is available. */
async function tryEmbed(text: string): Promise<{ embedding: number[]; model: string } | null> {
  try {
    const result = await embedText(text);
    return { embedding: result.embedding, model: result.model };
  } catch {
    return null;
  }
}

export async function addFile(input: { projectId: string; filename: string; content: string }): Promise<DocumentFile> {
  const { files, chunks } = await tables();
  const id = `doc-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const pieces = chunkText(input.content);

  files.insert({
    id,
    project_id: input.projectId,
    filename: input.filename,
    size: input.content.length,
    created_at: createdAt,
  });

  let ordinal = 0;
  for (const piece of pieces) {
    const embedded = await tryEmbed(piece);
    chunks.insert({
      id: `chunk-${randomUUID()}`,
      file_id: id,
      project_id: input.projectId,
      ordinal: ordinal++,
      text: piece,
      embedding: embedded ? JSON.stringify(embedded.embedding) : null,
      embed_model: embedded ? embedded.model : null,
    });
  }

  return {
    id,
    projectId: input.projectId,
    filename: input.filename,
    size: input.content.length,
    chunkCount: pieces.length,
    createdAt,
  };
}

export async function deleteFile(fileId: string): Promise<boolean> {
  const { files, chunks } = await tables();
  if (!files.findOne({ id: fileId })) return false;
  chunks.delete({ file_id: fileId });
  files.delete({ id: fileId });
  return true;
}

export async function listFiles(projectId: string): Promise<DocumentFile[]> {
  const { files, chunks } = await tables();
  const rows = files.findAll({ where: { project_id: projectId }, orderBy: 'created_at DESC' });
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    size: row.size,
    chunkCount: chunks.count({ file_id: row.id }),
    createdAt: row.created_at,
  }));
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function keywordScore(text: string, terms: string[]): number {
  const haystack = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    let index = haystack.indexOf(term);
    while (index !== -1) {
      score += 1;
      index = haystack.indexOf(term, index + term.length);
    }
  }
  return score;
}

export interface DocumentMatch {
  filename: string;
  text: string;
  score: number;
  mode: 'semantic' | 'keyword';
}

/**
 * Retrieve the most relevant chunks within a project. Semantic ranking is used
 * over chunks embedded with the *current* model; otherwise keyword matching.
 */
export async function searchProjectDocuments(
  projectId: string,
  query: string,
  topK = DEFAULT_TOP_K,
): Promise<DocumentMatch[]> {
  const { files, chunks } = await tables();
  const rows = chunks.findAll({ where: { project_id: projectId } });
  if (rows.length === 0) return [];

  const filenameById = new Map<string, string>();
  for (const file of files.findAll({ where: { project_id: projectId } })) {
    filenameById.set(file.id, file.filename);
  }

  const queryEmbedding = await tryEmbed(query);
  if (queryEmbedding) {
    const semantic = rows
      .filter((row) => row.embedding && row.embed_model === queryEmbedding.model)
      .map((row) => ({
        filename: filenameById.get(row.file_id) ?? 'unknown',
        text: row.text,
        score: cosineSimilarity(queryEmbedding.embedding, JSON.parse(row.embedding as string) as number[]),
        mode: 'semantic' as const,
      }))
      .filter((match) => match.score > 0.2)
      .sort((a, b) => b.score - a.score);
    if (semantic.length > 0) return semantic.slice(0, topK);
  }

  // Keyword fallback: any chunk whose text contains query terms.
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  return rows
    .map((row) => ({
      filename: filenameById.get(row.file_id) ?? 'unknown',
      text: row.text,
      score: keywordScore(row.text, terms),
      mode: 'keyword' as const,
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Drop files/chunks belonging to projects that no longer exist. */
export async function reconcileOrphans(): Promise<number> {
  const { files, chunks } = await tables();
  const live = new Set(listProjectIds());
  let removed = 0;
  for (const file of files.findAll()) {
    if (!live.has(file.project_id)) {
      chunks.delete({ file_id: file.id });
      files.delete({ id: file.id });
      removed += 1;
    }
  }
  return removed;
}

/** Test helper: reset cached table handles so a fresh DB path is picked up. */
export function resetDocumentStoreForTests(): void {
  filesTable = null;
  chunksTable = null;
}
