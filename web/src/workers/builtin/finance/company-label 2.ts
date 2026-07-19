/**
 * Compact labels for the commonly used tickers in the Finance News watchlist.
 * Values that are already a company or theme name intentionally pass through.
 */
const COMPANY_NAMES: Record<string, string> = {
  AAPL: 'Apple',
  AMZN: 'Amazon',
  GOOGL: 'Alphabet',
  META: 'Meta Platforms',
  MSFT: 'Microsoft',
  NVDA: 'NVIDIA',
  TSLA: 'Tesla',
};

export function companyLabel(value: string): string {
  const name = COMPANY_NAMES[value.trim().toUpperCase()];
  return name ? `${value} (${name})` : value;
}

export function companyLabels(values: string[]): string {
  return values.map(companyLabel).join(', ');
}
