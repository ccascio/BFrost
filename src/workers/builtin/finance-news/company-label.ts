/** Compact labels and matching aliases for commonly used finance watchlist entries. */
const COMPANY_NAMES: Record<string, string> = {
  AAPL: 'Apple',
  AMZN: 'Amazon',
  GOOGL: 'Alphabet',
  META: 'Meta Platforms',
  MSFT: 'Microsoft',
  NVDA: 'NVIDIA',
  TSLA: 'Tesla',
};

const EXTRA_ALIASES: Record<string, string[]> = {
  GOOGL: ['Google'],
  META: ['Facebook'],
  'S&P 500': ['S&P500', 'SPX'],
};

export function companyLabel(value: string): string {
  const name = COMPANY_NAMES[value.trim().toUpperCase()];
  return name ? `${value} (${name})` : value;
}

export function companyLabels(values: string[]): string {
  return values.map(companyLabel).join(', ');
}

/** Names that may identify a watchlist entry in an article. */
export function companyAliases(value: string): string[] {
  const normalized = value.trim();
  const upper = normalized.toUpperCase();
  const aliases = [normalized, COMPANY_NAMES[upper], ...(EXTRA_ALIASES[upper] ?? [])].filter(
    (entry): entry is string => Boolean(entry),
  );
  return [...new Set(aliases)];
}
