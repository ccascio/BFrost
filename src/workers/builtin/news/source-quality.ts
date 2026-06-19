import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import type { ArticleExtraction } from '../article-fetch/module';
import { loadKvJson, saveKvJson } from '../../../sqlite';
import { getNewsStoreDir } from './settings';

const SOURCE_RULES_STORE_KEY = 'news.sourceRules';

const SourceQualityRulesSchema = z.object({
  minScore: z.number().int(),
  allowHosts: z.array(z.string()),
  blockHosts: z.array(z.string()),
  preferredHosts: z.array(z.string()),
  lowQualityHosts: z.array(z.string()),
});

export interface SourceQualityRules {
  minScore: number;
  allowHosts: string[];
  blockHosts: string[];
  preferredHosts: string[];
  lowQualityHosts: string[];
}

export interface SourceAssessment {
  host: string;
  score: number;
  label: 'high' | 'medium' | 'low' | 'blocked';
  allowlisted: boolean;
  blocked: boolean;
  reasons: string[];
}

interface SourceAssessmentInput {
  url: string;
  title: string;
  snippet: string;
  article: ArticleExtraction;
}

const DEFAULT_SOURCE_QUALITY_RULES: SourceQualityRules = {
  minScore: 0,
  allowHosts: [],
  blockHosts: [
    'x.com',
    'twitter.com',
    'youtube.com',
    'youtu.be',
    'facebook.com',
    'instagram.com',
    'tiktok.com',
    'linkedin.com',
  ],
  preferredHosts: [
    'openai.com',
    'anthropic.com',
    'google.com',
    'deepmind.google',
    'mistral.ai',
    'huggingface.co',
    'arxiv.org',
    'techcrunch.com',
    'theverge.com',
    'arstechnica.com',
    'wired.com',
    'venturebeat.com',
    'reuters.com',
    'bloomberg.com',
  ],
  lowQualityHosts: [
    'prnewswire.com',
    'businesswire.com',
    'globenewswire.com',
    'accessnewswire.com',
    'newswire.com',
  ],
};

export function sourceQualityRulesPath(): string {
  return path.join(getNewsStoreDir(), 'source-rules.json');
}

export async function loadSourceQualityRules(): Promise<SourceQualityRules> {
  const stored = await loadKvJson<unknown>(SOURCE_RULES_STORE_KEY);
  if (stored !== null) {
    return normalizeRules(SourceQualityRulesSchema.parse(stored));
  }

  const rulesPath = sourceQualityRulesPath();

  try {
    const raw = await fs.readFile(rulesPath, 'utf8');
    const rules = normalizeRules(SourceQualityRulesSchema.parse(JSON.parse(raw)));
    await saveSourceQualityRules(rules);
    return rules;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[NewsDigest] Failed to read source-rules.json; using defaults:', err);
    }

    const defaults = normalizeRules(DEFAULT_SOURCE_QUALITY_RULES);
    await saveSourceQualityRules(defaults);
    return defaults;
  }
}

export async function saveSourceQualityRules(rules: SourceQualityRules): Promise<SourceQualityRules> {
  const normalized = normalizeRules(SourceQualityRulesSchema.parse(rules));
  await saveKvJson(SOURCE_RULES_STORE_KEY, normalized);
  return normalized;
}

export function assessSourceQuality(
  input: SourceAssessmentInput,
  rules: SourceQualityRules,
): SourceAssessment {
  const host = safeHost(input.article.finalUrl || input.url);
  const reasons: string[] = [];

  if (hostMatches(host, rules.blockHosts)) {
    reasons.push(`Blocked host: ${host}.`);
    return {
      host,
      score: -100,
      label: 'blocked',
      allowlisted: false,
      blocked: true,
      reasons,
    };
  }

  let score = 0;
  const allowlisted = hostMatches(host, rules.allowHosts);

  if (allowlisted) {
    score += 4;
    reasons.push(`Allowlisted host: ${host}.`);
  }

  if (hostMatches(host, rules.preferredHosts)) {
    score += 2;
    reasons.push(`Preferred host: ${host}.`);
  }

  if (hostMatches(host, rules.lowQualityHosts)) {
    score -= 3;
    reasons.push(`Host is marked low quality: ${host}.`);
  }

  if (input.article.fetched) {
    if (input.article.content.length >= 600) {
      score += 2;
      reasons.push('Article page extracted with substantial text.');
    } else if (input.article.content.length >= 200) {
      score += 1;
      reasons.push('Article page extracted successfully.');
    } else {
      reasons.push('Article page extracted but content was limited.');
    }
  } else {
    score -= 1;
    reasons.push(`Article fetch failed: ${input.article.error || 'unknown error'}.`);
  }

  const signalText = [
    input.title,
    input.snippet,
    input.article.title,
    input.article.description,
  ]
    .join(' ')
    .toLowerCase();

  if (/\b(how to|tips|guide|review|opinion|editorial|analysis)\b/.test(signalText)) {
    score -= 2;
    reasons.push('Headline/snippet looks more like evergreen or opinion content than hard news.');
  }

  if (
    /\b(press release|business wire|pr newswire|globe newswire|access newswire|newswire)\b/.test(
      signalText,
    )
  ) {
    score -= 3;
    reasons.push('Looks like press-release distribution content.');
  }

  if (/\b(sponsored|advertorial|partner content)\b/.test(signalText)) {
    score -= 3;
    reasons.push('Looks like sponsored or promotional content.');
  }

  let label: SourceAssessment['label'] = 'low';
  if (score >= 4) {
    label = 'high';
  } else if (score >= 1) {
    label = 'medium';
  }

  return {
    host,
    score,
    label,
    allowlisted,
    blocked: false,
    reasons,
  };
}

export function summarizeSourceAssessment(assessment: SourceAssessment): string {
  const headline = `source ${assessment.host || 'unknown'} scored ${assessment.score} (${assessment.label})`;
  const detail = assessment.reasons.slice(0, 2).join(' ');
  return detail ? `${headline}. ${detail}` : headline;
}

function normalizeRules(input: SourceQualityRules): SourceQualityRules {
  return {
    minScore: input.minScore,
    allowHosts: normalizeHosts(input.allowHosts),
    blockHosts: normalizeHosts(input.blockHosts),
    preferredHosts: normalizeHosts(input.preferredHosts),
    lowQualityHosts: normalizeHosts(input.lowQualityHosts),
  };
}

function normalizeHosts(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function hostMatches(host: string, rules: string[]): boolean {
  return rules.some((rule) => host === rule || host.endsWith(`.${rule}`));
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
