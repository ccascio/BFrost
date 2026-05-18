export interface DuplicateReference {
  title: string;
  url: string;
  origin: 'existing' | 'candidate';
}

export interface DuplicateMatch {
  kind: 'canonical-url' | 'near-title';
  against: DuplicateReference;
  similarity?: number;
  detail: string;
}

const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'ref_url',
  'igshid',
  'ocid',
  'cmpid',
  'campaign_id',
]);

const TITLE_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'for',
  'from',
  'into',
  'onto',
  'with',
  'without',
  'over',
  'under',
  'after',
  'before',
  'today',
  'latest',
  'report',
  'reports',
  'says',
  'say',
  'new',
]);

export function canonicalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const pathname = normalizePath(url.pathname);
    const params = [...url.searchParams.entries()]
      .filter(([key, raw]) => {
        const normalized = key.toLowerCase();
        if (!raw) return false;
        if (TRACKING_PARAMS.has(normalized)) return false;
        return !hasTrackingParamPrefix(normalized);
      })
      .sort(([a], [b]) => a.localeCompare(b));

    const search = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
    return `${host}${pathname}${search}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

export function normalizeTitleForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findNearDuplicateMatch(
  candidate: DuplicateReference,
  others: DuplicateReference[],
): DuplicateMatch | null {
  const candidateCanonicalUrl = canonicalizeUrl(candidate.url);

  for (const other of others) {
    if (candidateCanonicalUrl && candidateCanonicalUrl === canonicalizeUrl(other.url)) {
      return {
        kind: 'canonical-url',
        against: other,
        detail: `Canonical URL matches ${other.origin} item "${truncateTitle(other.title)}".`,
      };
    }
  }

  const candidateTitle = normalizeTitleForDedup(candidate.title);
  if (!candidateTitle) {
    return null;
  }

  let best: DuplicateMatch | null = null;
  for (const other of others) {
    const otherTitle = normalizeTitleForDedup(other.title);
    if (!otherTitle) {
      continue;
    }

    const similarity = titleSimilarity(candidateTitle, otherTitle);
    if (!isNearDuplicateTitle(candidateTitle, otherTitle, similarity)) {
      continue;
    }

    if (!best || (best.similarity ?? 0) < similarity) {
      best = {
        kind: 'near-title',
        against: other,
        similarity,
        detail: `Title is ${(similarity * 100).toFixed(0)}% similar to ${other.origin} item "${truncateTitle(other.title)}".`,
      };
    }
  }

  return best;
}

function normalizePath(pathname: string): string {
  let path = pathname || '/';
  path = path.replace(/\/{2,}/g, '/');
  path = path.replace(/\/index\.(html?|php)$/i, '/');
  path = path.replace(/\/amp\/?$/i, '/');
  path = path !== '/' ? path.replace(/\/+$/g, '') : path;
  return path || '/';
}

function hasTrackingParamPrefix(key: string): boolean {
  return TRACKING_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function titleSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }

  const tokensA = tokenSet(a);
  const tokensB = tokenSet(b);
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(tokensA.size, tokensB.size);
  return Math.max(jaccard, containment * 0.95);
}

function isNearDuplicateTitle(a: string, b: string, similarity: number): boolean {
  const tokensA = tokenSet(a);
  const tokensB = tokenSet(b);
  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;

  if (a === b) {
    return true;
  }

  if (shorter.length >= 40 && longer.includes(shorter)) {
    return true;
  }

  if (intersection >= 5 && similarity >= 0.78) {
    return true;
  }

  if (intersection >= 4 && similarity >= 0.84) {
    return true;
  }

  return false;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !TITLE_STOPWORDS.has(token)),
  );
}

function truncateTitle(title: string): string {
  return title.length > 90 ? `${title.slice(0, 87)}...` : title;
}
