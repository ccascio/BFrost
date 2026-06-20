import { PI_COMPATIBLE_PROVIDERS, type PiCompatibleProviderDefinition } from './catalog';

const apiKeys = new Map<string, string>(
  PI_COMPATIBLE_PROVIDERS.map((provider) => [provider.id, process.env[provider.envVar] || '']),
);

let cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';

export function resolvePiProviderApiKey(provider: PiCompatibleProviderDefinition): string {
  return (apiKeys.get(provider.id) ?? '').trim();
}

export function setPiProviderApiKey(providerId: string, value: string): void {
  apiKeys.set(providerId, value.trim());
}

export function resolveCloudflareAccountId(): string {
  return cloudflareAccountId.trim();
}

export function setCloudflareAccountId(value: string): void {
  cloudflareAccountId = value.trim();
}

export function resolvePiProviderBaseURL(provider: PiCompatibleProviderDefinition): string {
  if (!provider.requiresCloudflareAccountId) return provider.baseURL;
  const accountId = resolveCloudflareAccountId();
  if (!accountId) return provider.baseURL;
  return provider.baseURL.replace('{CLOUDFLARE_ACCOUNT_ID}', encodeURIComponent(accountId));
}

export function isPiProviderConfigured(provider: PiCompatibleProviderDefinition): boolean {
  if (!resolvePiProviderApiKey(provider)) return false;
  if (provider.requiresCloudflareAccountId && !resolveCloudflareAccountId()) return false;
  return true;
}

export function piCompatibleSettingsSnapshot() {
  return {
    cloudflareAccountId: resolveCloudflareAccountId(),
    configuredProviders: PI_COMPATIBLE_PROVIDERS
      .filter((provider) => isPiProviderConfigured(provider))
      .map((provider) => provider.id),
  };
}
