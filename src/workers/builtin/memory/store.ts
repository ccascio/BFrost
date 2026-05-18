import { readFile } from 'fs/promises';
import https from 'https';
import http from 'http';
import { config } from '../../../config';
import { loadKvJson, saveKvJson } from '../../../sqlite';

const MEMORY_STORE_KEY = 'assistant.memory';

interface MemoryEntry {
  id: string;
  summary: string;
  embedding: number[];
  timestamp: string;
}

let entries: MemoryEntry[] | null = null;

async function load(): Promise<MemoryEntry[]> {
  if (entries !== null) return entries;
  const stored = await loadKvJson<unknown>(MEMORY_STORE_KEY);
  if (Array.isArray(stored)) {
    entries = stored as MemoryEntry[];
    return entries;
  }

  try {
    const data = await readFile(config.memoryStorePath, 'utf-8');
    entries = JSON.parse(data);
    await save();
  } catch {
    entries = [];
  }
  return entries!;
}

async function save(): Promise<void> {
  if (!entries) return;
  await saveKvJson(MEMORY_STORE_KEY, entries);
}

async function embed(text: string): Promise<number[]> {
  const isOpenAI = config.embeddingProvider === 'openai';
  const baseUrl = isOpenAI ? 'https://api.openai.com/v1' : config.ollamaBaseUrl.replace(/\/$/, '');
  const endpoint = isOpenAI ? `${baseUrl}/embeddings` : `${baseUrl}/embeddings`;

  if (isOpenAI && !config.openaiApiKey) {
    throw new Error('OpenAI API key is not configured. Set it in Config → Cloud API keys.');
  }

  const body = JSON.stringify({
    model: config.embeddingModel,
    input: text,
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (isOpenAI) headers['Authorization'] = `Bearer ${config.openaiApiKey}`;

  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.request(url, {
      method: 'POST',
      headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          resolve(data.data[0].embedding);
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function saveMemory(summary: string): Promise<void> {
  const store = await load();
  const embedding = await embed(summary);

  store.push({
    id: `mem_${Date.now()}`,
    summary,
    embedding,
    timestamp: new Date().toISOString(),
  });

  await save();
  console.log(`[Memory] Saved: "${summary.substring(0, 60)}..."`);
}

export async function searchMemory(query: string, topK = 3): Promise<string[]> {
  const store = await load();
  if (store.length === 0) return [];

  const queryEmbedding = await embed(query);

  const scored = store.map((entry) => ({
    summary: entry.summary,
    timestamp: entry.timestamp,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored
    .slice(0, topK)
    .filter((s) => s.score > 0.3)
    .map((s) => `[${s.timestamp.substring(0, 10)}] ${s.summary}`);
}
