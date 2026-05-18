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

  const preferredSection =
    matchTagText(html, 'article') ||
    matchTagText(html, 'main') ||
    matchTagText(html, 'body') ||
    html;

  const maxExtractedTextChars = clampMaxExtractedTextChars(options.maxExtractedTextChars);
  const content = cleanText(preferredSection).slice(0, maxExtractedTextChars);

  return { title, description, content };
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
