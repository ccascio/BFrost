import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { generateText } from 'ai';
import { config, findModel } from '../../../config';
import { getChatModel } from '../../../llm';
import { fetchArticle } from '../article-fetch/module';
import { searchGoogle, type SearchResult } from '../search-google/module';
import { loadKvJson, saveKvJson } from '../../../sqlite';
import { recordEventSafe } from '../../../event-log';
import { getResearchStoreDir } from './settings';

const ARTICLE_FETCH_CONCURRENCY = 3;
const RESEARCH_INDEX_KEY = 'research.notes';
const RESEARCH_SETTINGS_KEY = 'research.settings';
const ADMIN_SETTINGS_STORE_KEY = 'admin.settings';
const RESEARCH_TIMEOUT_MS = 300000;
const RESEARCH_EVENT_METADATA = {
  workerId: 'core.research',
  workerName: 'Research',
  job: 'personal-research',
} as const;

export const PersonalResearchParamsSchema = z.object({
  maxTopics: z.number().int().min(1).max(20).catch(5),
  resultsPerTopic: z.number().int().min(1).max(20).catch(5),
  dateRestrict: z.string().min(1).catch('m1'),
});
export type PersonalResearchParams = z.infer<typeof PersonalResearchParamsSchema>;
export const DEFAULT_PERSONAL_RESEARCH_PARAMS: PersonalResearchParams = PersonalResearchParamsSchema.parse({});
export function resolvePersonalResearchParams(raw: unknown): PersonalResearchParams {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PERSONAL_RESEARCH_PARAMS;
  return PersonalResearchParamsSchema.parse(raw);
}

export const DEFAULT_RESEARCH_PROMPT = `You are a personal research analyst.

Synthesize the provided web findings into a concise research note.

Focus on:
- what changed or seems important
- why it matters
- practical implications
- open questions to track next

Avoid hype. Prefer concrete facts over speculation. Include source links in a final "Sources" section.

Return Markdown only.`;

interface ResearchFinding extends SearchResult {
  topic: string;
  articleTitle: string;
  articleDescription: string;
  articleContent: string;
  fetched: boolean;
}

export interface ResearchNoteRecord {
  id: string;
  title: string;
  topics: string[];
  createdAt: string;
  filePath: string;
  sourceCount: number;
}

export interface ResearchSettings {
  topics: string[];
}

interface StoredAdminSettings {
  jobs?: {
    'personal-research'?: {
      prompt?: string;
    };
  };
}

export function parseResearchTopics(value: string): string[] {
  return value
    .split(',')
    .map((topic) => topic.trim())
    .filter(Boolean)
    .slice(0, DEFAULT_PERSONAL_RESEARCH_PARAMS.maxTopics);
}

export async function loadResearchSettings(): Promise<ResearchSettings> {
  const stored = await loadKvJson<Partial<ResearchSettings>>(RESEARCH_SETTINGS_KEY);
  return {
    topics: Array.isArray(stored?.topics)
      ? stored.topics
          .map((topic) => (typeof topic === 'string' ? topic.trim() : ''))
          .filter(Boolean)
      : [],
  };
}

export async function saveResearchSettings(input: ResearchSettings): Promise<ResearchSettings> {
  const settings = {
    topics: input.topics.map((topic) => topic.trim()).filter(Boolean),
  };
  await saveKvJson(RESEARCH_SETTINGS_KEY, settings);
  return settings;
}

export async function listResearchNotes(limit = 20): Promise<ResearchNoteRecord[]> {
  const notes = (await loadKvJson<ResearchNoteRecord[]>(RESEARCH_INDEX_KEY)) ?? [];
  return notes.slice(0, limit);
}

export async function runPersonalResearch(modelId: string, params: PersonalResearchParams = DEFAULT_PERSONAL_RESEARCH_PARAMS): Promise<{ summary: string; itemCount: number }> {
  const allTopics = (await loadResearchSettings()).topics;
  const topics = allTopics.slice(0, params.maxTopics);
  const prompt = await loadResearchPrompt();
  if (topics.length === 0) {
    return {
      summary: 'Personal research: no topics configured. Add topics in the Research dashboard tab.',
      itemCount: 0,
    };
  }

  await recordEventSafe({
    category: 'research',
    action: 'started',
    summary: `Research started for ${topics.length} topics.`,
    metadata: { ...RESEARCH_EVENT_METADATA, topics },
  });

  const findings = await collectFindings(topics, params);
  await recordEventSafe({
    category: 'research',
    action: 'sources_collected',
    summary: `Collected ${findings.length} research sources.`,
    metadata: { ...RESEARCH_EVENT_METADATA, topics, sourceCount: findings.length },
  });
  if (findings.length === 0) {
    return {
      summary: `Personal research: no web results found for ${topics.join(', ')}.`,
      itemCount: 0,
    };
  }

  await recordEventSafe({
    category: 'research',
    action: 'synthesis_started',
    summary: `Synthesizing research note for ${topics.join(', ')}.`,
    metadata: { ...RESEARCH_EVENT_METADATA, topics, sourceCount: findings.length },
  });
  const markdown = await synthesizeResearchNote(modelId, topics, findings, prompt);
  const record = await saveResearchNote(topics, markdown, findings.length);
  await recordEventSafe({
    category: 'research',
    action: 'note_created',
    summary: `Created personal research note: ${record.title}`,
    metadata: {
      ...RESEARCH_EVENT_METADATA,
      id: record.id,
      topics,
      filePath: record.filePath,
      sourceCount: record.sourceCount,
    },
  });

  return {
    summary:
      `Personal research: created note "${record.title}" with ${record.sourceCount} sources.\n` +
      `Saved to ${record.filePath}`,
    itemCount: 1,
  };
}

async function loadResearchPrompt(): Promise<string> {
  const stored = await loadKvJson<StoredAdminSettings>(ADMIN_SETTINGS_STORE_KEY);
  const prompt = stored?.jobs?.['personal-research']?.prompt;
  return typeof prompt === 'string' && prompt.trim() ? prompt : DEFAULT_RESEARCH_PROMPT;
}

async function collectFindings(topics: string[], params: PersonalResearchParams): Promise<ResearchFinding[]> {
  const results: ResearchFinding[] = [];

  for (const topic of topics) {
    await recordEventSafe({
      category: 'research',
      action: 'topic_started',
      summary: `Researching topic: ${topic}`,
      metadata: { ...RESEARCH_EVENT_METADATA, topic },
    });
    const query = `${topic} latest research developments`;
    console.log(`[Research] Google CSE query: "${query}"`);
    const searchResults = await searchGoogle(query, {
      num: params.resultsPerTopic,
      dateRestrict: params.dateRestrict,
      sort: 'date',
    });
    await recordEventSafe({
      category: 'research',
      action: 'search_completed',
      summary: `Found ${searchResults.length} search results for ${topic}.`,
      metadata: { ...RESEARCH_EVENT_METADATA, topic, query, resultCount: searchResults.length },
    });

    for (let start = 0; start < searchResults.length; start += ARTICLE_FETCH_CONCURRENCY) {
      const batch = searchResults.slice(start, start + ARTICLE_FETCH_CONCURRENCY);
      const enriched = await Promise.all(
        batch.map(async (result) => {
          const article = await fetchArticle(result.link);
          return {
            ...result,
            topic,
            articleTitle: article.title,
            articleDescription: article.description,
            articleContent: article.content,
            fetched: article.fetched,
          };
        }),
      );
      results.push(...enriched);
      await recordEventSafe({
        category: 'research',
        action: 'articles_fetched',
        summary: `Fetched ${enriched.filter((item) => item.fetched).length}/${enriched.length} articles for ${topic}.`,
        metadata: {
          ...RESEARCH_EVENT_METADATA,
          topic,
          fetchedCount: enriched.filter((item) => item.fetched).length,
          attemptedCount: enriched.length,
        },
      });
    }
  }

  return dedupeFindings(results);
}

function dedupeFindings(findings: ResearchFinding[]): ResearchFinding[] {
  const seen = new Set<string>();
  const out: ResearchFinding[] = [];
  for (const finding of findings) {
    const key = canonicalUrl(finding.link);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

async function synthesizeResearchNote(
  modelId: string,
  topics: string[],
  findings: ResearchFinding[],
  systemPrompt: string,
): Promise<string> {
  const modelOption = findModel(modelId);
  if (!modelOption) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const sources = findings
    .map((finding, index) => {
      const content = finding.articleContent || finding.snippet;
      return (
        `[${index + 1}] Topic: ${finding.topic}\n` +
        `Title: ${finding.articleTitle || finding.title}\n` +
        `Description: ${finding.articleDescription || finding.snippet}\n` +
        `URL: ${finding.link}\n` +
        `Fetched: ${finding.fetched ? 'yes' : 'no'}\n` +
        `Excerpt: ${content.slice(0, 1200)}`
      );
    })
    .join('\n\n');

  const { text } = await generateText({
    model: getChatModel(modelOption),
    system: systemPrompt,
    // /no_think disables Qwen3's extended thinking mode. Other models ignore this prefix.
    prompt:
      `/no_think\n` +
      `Research topics: ${topics.join(', ')}\n\n` +
      `Write a dated Markdown research note from these findings.\n\n` +
      `Findings:\n\n${sources}`,
    timeout: RESEARCH_TIMEOUT_MS,
  });

  return text.trim();
}

async function saveResearchNote(
  topics: string[],
  markdown: string,
  sourceCount: number,
): Promise<ResearchNoteRecord> {
  const now = new Date();
  const createdAt = now.toISOString();
  const slug = slugify(topics[0] || 'research');
  const id = `${createdAt.replace(/[:.]/g, '-')}-${slug}`;
  const title = `${topics.join(', ')} — ${createdAt.slice(0, 10)}`;
  const storeDir = getResearchStoreDir();
  const filePath = path.join(storeDir, `${id}.md`);
  const body = `# ${title}\n\n${markdown}\n`;

  await fs.mkdir(storeDir, { recursive: true });
  await fs.writeFile(filePath, body, 'utf8');

  const record: ResearchNoteRecord = {
    id,
    title,
    topics,
    createdAt,
    filePath,
    sourceCount,
  };
  const existing = (await loadKvJson<ResearchNoteRecord[]>(RESEARCH_INDEX_KEY)) ?? [];
  await saveKvJson(RESEARCH_INDEX_KEY, [record, ...existing].slice(0, 100));
  return record;
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'research';
}
