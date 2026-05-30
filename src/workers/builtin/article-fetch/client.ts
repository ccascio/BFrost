import { URL } from 'url';

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_CHARS = 800_000;
const DEFAULT_MAX_EXTRACTED_TEXT_CHARS = 4_000;
const MAX_DESCRIPTION_CHARS = 280;
const MAX_TITLE_CHARS = 180;

export interface FetchArticleOptions {
  maxExtractedTextChars?: number;
}

export interface ArticleExtraction {
  sourceUrl: string;
  finalUrl: string;
  sourceHost: string;
  fetched: boolean;
  title: string;
  description: string;
  content: string;
  statusCode?: number;
  error?: string;
}

export async function fetchArticle(url: string, options: FetchArticleOptions = {}): Promise<ArticleExtraction> {
  const sourceHost = safeHost(url);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'BFrost/0.1 (+local news digest)',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.5,*/*;q=0.1',
      },
    });

    const finalUrl = response.url || url;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!response.ok) {
      return buildFailure(url, finalUrl, sourceHost, `HTTP ${response.status}`, response.status);
    }

    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return buildFailure(
        url,
        finalUrl,
        sourceHost,
        `Unsupported content type: ${contentType || 'unknown'}`,
        response.status,
      );
    }

    const html = (await response.text()).slice(0, MAX_HTML_CHARS);
    const extracted = extractFromHtml(html, finalUrl, sourceHost, options);
    return {
      sourceUrl: url,
      finalUrl,
      sourceHost,
      fetched: true,
      title: extracted.title,
      description: extracted.description,
      content: extracted.content,
      statusCode: response.status,
    };
  } catch (err) {
    return buildFailure(url, url, sourceHost, err instanceof Error ? err.message : String(err));
  }
}

function buildFailure(
  sourceUrl: string,
  finalUrl: string,
  sourceHost: string,
  error: string,
  statusCode?: number,
): ArticleExtraction {
  return {
    sourceUrl,
    finalUrl,
    sourceHost,
    fetched: false,
    title: '',
    description: '',
    content: '',
    statusCode,
    error,
  };
}

function extractFromHtml(
  html: string,
  finalUrl: string,
  sourceHost: string,
  options: FetchArticleOptions,
): Pick<ArticleExtraction, 'title' | 'description' | 'content'> {
  const title =
    firstNonEmpty(
      matchMetaContent(html, 'property', 'og:title'),
      matchMetaContent(html, 'name', 'twitter:title'),
      matchTagText(html, 'title'),
    ).slice(0, MAX_TITLE_CHARS) || sourceHost || safeHost(finalUrl);

  const description =
    firstNonEmpty(
      matchMetaContent(html, 'name', 'description'),
      matchMetaContent(html, 'property', 'og:description'),
      matchMetaContent(html, 'name', 'twitter:description'),
    ).slice(0, MAX_DESCRIPTION_CHARS);

  const content = extractReadableArticleText(html, options);

  return { title, description, content };
}

export function extractReadableArticleText(html: string, options: FetchArticleOptions = {}): string {
  const maxExtractedTextChars = clampMaxExtractedTextChars(options.maxExtractedTextChars);
  const candidates = [
    ...extractJsonLdArticleBodies(html),
    ...matchAllTagText(html, 'article'),
    ...matchAllReadableContainers(html),
    ...matchAllTagText(html, 'main'),
    matchTagText(html, 'body'),
    html,
  ].filter(Boolean);
  let best = '';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const cleaned = stripBoilerplateLines(cleanText(candidate));
    const score = scoreReadableText(cleaned);
    if (score > bestScore) {
      best = cleaned;
      bestScore = score;
    }
  }
  return best.slice(0, maxExtractedTextChars);
}

function clampMaxExtractedTextChars(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_EXTRACTED_TEXT_CHARS;
  return Math.min(Math.max(Math.floor(value), 1_000), 80_000);
}

function matchMetaContent(html: string, attrName: 'name' | 'property', attrValue: string): string {
  const escaped = escapeRegExp(attrValue);
  const patterns = [
    new RegExp(
      `<meta[^>]*${attrName}\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']+)["'][^>]*>`,
      'i',
    ),
    new RegExp(
      `<meta[^>]*content\\s*=\\s*["']([^"']+)["'][^>]*${attrName}\\s*=\\s*["']${escaped}["'][^>]*>`,
      'i',
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtml(match[1]);
    }
  }

  return '';
}

function matchTagText(html: string, tagName: string): string {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'));
  return match?.[1] ? decodeHtml(match[1]) : '';
}

function matchAllTagText(html: string, tagName: string): string[] {
  return [...html.matchAll(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'gi'))]
    .map((match) => (match[1] ? decodeHtml(match[1]) : ''))
    .filter(Boolean);
}

function matchAllReadableContainers(html: string): string[] {
  const readableAttr =
    '(?:article[-_ ]?body|article[-_ ]?content|story[-_ ]?body|story[-_ ]?content|entry[-_ ]?content|post[-_ ]?content|main[-_ ]?content|body[-_ ]?content|content[-_ ]?body)';
  const blocks: string[] = [];
  const pattern = new RegExp(
    `<(div|section)[^>]*(?:class|id)\\s*=\\s*["'][^"']*${readableAttr}[^"']*["'][^>]*>([\\s\\S]*?)</\\1>`,
    'gi',
  );
  for (const match of html.matchAll(pattern)) {
    if (match[2]) blocks.push(decodeHtml(match[2]));
  }
  return blocks;
}

function extractJsonLdArticleBodies(html: string): string[] {
  const bodies: string[] = [];
  const scripts = html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    const raw = cleanJsonLd(script[1] ?? '');
    if (!raw) continue;
    try {
      collectArticleBodies(JSON.parse(raw), bodies);
    } catch {
      // Some publishers emit malformed JSON-LD. Ignore and keep looking.
    }
  }
  return bodies;
}

function cleanJsonLd(value: string): string {
  return decodeHtml(value)
    .replace(/^\s*<!--/, '')
    .replace(/-->\s*$/, '')
    .trim();
}

function collectArticleBodies(value: unknown, out: string[]): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectArticleBodies(entry, out);
    return;
  }
  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record['@graph'])) collectArticleBodies(record['@graph'], out);
  const type = record['@type'];
  const types = Array.isArray(type) ? type : [type];
  const isArticle = types.some((entry) =>
    typeof entry === 'string' && /article|newsarticle|blogposting|report/i.test(entry)
  );
  const body = record.articleBody;
  if (isArticle && typeof body === 'string' && body.trim()) out.push(body);
  const description = record.description;
  if (isArticle && typeof description === 'string' && description.trim()) out.push(description);
}

function cleanText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');

  const withBreaks = withoutNoise
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n');

  const text = withBreaks.replace(/<[^>]+>/g, ' ');
  return decodeHtml(text)
    .replace(/\r/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripBoilerplateLines(text: string): string {
  const seen = new Set<string>();
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    const words = line.split(/\s+/).length;
    if (isBoilerplateLine(lower, words)) continue;
    const key = lower.replace(/\W+/g, ' ').trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    kept.push(line);
  }
  return kept.join('\n\n').trim();
}

function isBoilerplateLine(lower: string, words: number): boolean {
  if (words <= 2 && /^(home|menu|search|login|subscribe|advertisement|share|comments?)$/.test(lower)) return true;
  if (/\b(skip to content|sign in|log in|create account|subscribe now|accept cookies|cookie policy|privacy policy|terms of use|all rights reserved|advertisement|sponsored content|share this article|follow us|newsletter|related articles)\b/.test(lower)) {
    return true;
  }
  if (words <= 8 && /\b(markets|business|technology|politics|world|opinion|video|audio|latest|more|close)\b/.test(lower)) return true;
  return false;
}

function scoreReadableText(text: string): number {
  if (!text) return Number.NEGATIVE_INFINITY;
  const words = text.split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  const sentenceCount = (text.match(/[.!?](?:\s|$)/g) ?? []).length;
  const paragraphCount = text
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.split(/\s+/).filter(Boolean).length >= 20).length;
  const boilerplateHits = (lower.match(/\b(subscribe|advertisement|cookie|privacy policy|sign in|newsletter|share this|all rights reserved)\b/g) ?? []).length;
  const uniqueRatio = new Set(words.map((word) => word.toLowerCase())).size / Math.max(words.length, 1);
  return words.length + sentenceCount * 15 + paragraphCount * 45 + uniqueRatio * 100 - boilerplateHits * 80;
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number.parseInt(digits, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => {
      const code = Number.parseInt(digits, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function firstNonEmpty(...values: string[]): string {
  return values.find((value) => value.trim().length > 0)?.trim() || '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
