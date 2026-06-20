import type { WorkerProviderDefaultModel } from '../../types';

export interface PiCompatibleProviderDefinition {
  id: string;
  label: string;
  description: string;
  transport: 'openai-compatible' | 'anthropic-compatible';
  envVar: string;
  apiKeySettingKey: string;
  baseURL: string;
  headers?: Record<string, string>;
  defaultModels: WorkerProviderDefaultModel[];
  requiresCloudflareAccountId?: boolean;
}

export const PI_COMPATIBLE_WORKER_ID = 'core.providers.pi-compatible';

export const PI_COMPATIBLE_PROVIDERS: PiCompatibleProviderDefinition[] = [
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    description: 'NVIDIA hosted NIM models through the OpenAI-compatible integration API.',
    transport: 'openai-compatible',
    envVar: 'NVIDIA_API_KEY',
    apiKeySettingKey: 'nvidiaApiKey',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    headers: { 'NVCF-POLL-SECONDS': '3600' },
    defaultModels: [
      { alias: 'nvidia-llama-3.3-70b', id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
      { alias: 'nvidia-llama-3.1-70b', id: 'meta/llama-3.1-70b-instruct', label: 'Llama 3.1 70B Instruct' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek chat models through the OpenAI-compatible API.',
    transport: 'openai-compatible',
    envVar: 'DEEPSEEK_API_KEY',
    apiKeySettingKey: 'deepseekApiKey',
    baseURL: 'https://api.deepseek.com',
    defaultModels: [
      { alias: 'deepseek-v4-flash', id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { alias: 'deepseek-v4-pro', id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
  },
  {
    id: 'xai',
    label: 'xAI',
    description: 'xAI Grok models through the OpenAI-compatible API.',
    transport: 'openai-compatible',
    envVar: 'XAI_API_KEY',
    apiKeySettingKey: 'xaiApiKey',
    baseURL: 'https://api.x.ai/v1',
    defaultModels: [
      { alias: 'grok-4.3', id: 'grok-4.3', label: 'Grok 4.3' },
      { alias: 'grok-3', id: 'grok-3', label: 'Grok 3' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    description: 'Groq-hosted low-latency chat models through its OpenAI-compatible API.',
    transport: 'openai-compatible',
    envVar: 'GROQ_API_KEY',
    apiKeySettingKey: 'groqApiKey',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModels: [
      { alias: 'groq-llama-3.3-70b', id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
      { alias: 'groq-gpt-oss-120b', id: 'openai/gpt-oss-120b', label: 'GPT OSS 120B' },
    ],
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    description: 'Cerebras hosted inference through its OpenAI-compatible API.',
    transport: 'openai-compatible',
    envVar: 'CEREBRAS_API_KEY',
    apiKeySettingKey: 'cerebrasApiKey',
    baseURL: 'https://api.cerebras.ai/v1',
    defaultModels: [
      { alias: 'cerebras-gpt-oss-120b', id: 'gpt-oss-120b', label: 'GPT OSS 120B' },
      { alias: 'cerebras-glm-4.7', id: 'zai-glm-4.7', label: 'Z.AI GLM-4.7' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'OpenRouter model routing through its OpenAI-compatible API.',
    transport: 'openai-compatible',
    envVar: 'OPENROUTER_API_KEY',
    apiKeySettingKey: 'openrouterApiKey',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModels: [
      { alias: 'openrouter-jamba-large', id: 'ai21/jamba-large-1.7', label: 'AI21 Jamba Large 1.7' },
      { alias: 'openrouter-nova-lite', id: 'amazon/nova-lite-v1', label: 'Amazon Nova Lite 1.0' },
    ],
  },
  {
    id: 'vercel-ai-gateway',
    label: 'Vercel AI Gateway',
    description: 'Vercel AI Gateway tool-use tagged models through its Anthropic-compatible endpoint.',
    transport: 'anthropic-compatible',
    envVar: 'AI_GATEWAY_API_KEY',
    apiKeySettingKey: 'vercelAiGatewayApiKey',
    baseURL: 'https://ai-gateway.vercel.sh',
    defaultModels: [
      { alias: 'vercel-qwen3-coder', id: 'alibaba/qwen3-coder', label: 'Qwen3 Coder 480B' },
      { alias: 'vercel-qwen3-235b', id: 'alibaba/qwen-3-235b', label: 'Qwen3 235B A22B' },
    ],
  },
  {
    id: 'zai',
    label: 'Z.AI',
    description: 'Z.AI GLM coding models through the OpenAI-compatible endpoint.',
    transport: 'openai-compatible',
    envVar: 'ZAI_API_KEY',
    apiKeySettingKey: 'zaiApiKey',
    baseURL: 'https://api.z.ai/api/coding/paas/v4',
    defaultModels: [
      { alias: 'glm-4.7', id: 'glm-4.7', label: 'GLM-4.7' },
      { alias: 'glm-4.5-air', id: 'glm-4.5-air', label: 'GLM-4.5-Air' },
    ],
  },
  {
    id: 'moonshotai',
    label: 'Moonshot AI',
    description: 'Moonshot Kimi models through its OpenAI-compatible API.',
    transport: 'openai-compatible',
    envVar: 'MOONSHOT_API_KEY',
    apiKeySettingKey: 'moonshotApiKey',
    baseURL: 'https://api.moonshot.ai/v1',
    defaultModels: [
      { alias: 'kimi-k2-thinking', id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking' },
      { alias: 'kimi-k2-turbo', id: 'kimi-k2-turbo-preview', label: 'Kimi K2 Turbo' },
    ],
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    description: 'Hugging Face router models through the OpenAI-compatible API.',
    transport: 'openai-compatible',
    envVar: 'HF_TOKEN',
    apiKeySettingKey: 'huggingFaceToken',
    baseURL: 'https://router.huggingface.co/v1',
    defaultModels: [
      { alias: 'hf-qwen3-coder', id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct', label: 'Qwen3 Coder 480B' },
      { alias: 'hf-minimax-m2.7', id: 'MiniMaxAI/MiniMax-M2.7', label: 'MiniMax M2.7' },
    ],
  },
  {
    id: 'together',
    label: 'Together AI',
    description: 'Together AI hosted models through its OpenAI-compatible API.',
    transport: 'openai-compatible',
    envVar: 'TOGETHER_API_KEY',
    apiKeySettingKey: 'togetherApiKey',
    baseURL: 'https://api.together.ai/v1',
    defaultModels: [
      { alias: 'together-minimax-m2.7', id: 'MiniMaxAI/MiniMax-M2.7', label: 'MiniMax M2.7' },
      { alias: 'together-qwen3.5', id: 'Qwen/Qwen3.5-397B-A17B', label: 'Qwen3.5 397B' },
    ],
  },
  {
    id: 'opencode',
    label: 'OpenCode Zen',
    description: 'OpenCode Zen hosted models through the OpenAI-compatible endpoint.',
    transport: 'openai-compatible',
    envVar: 'OPENCODE_API_KEY',
    apiKeySettingKey: 'opencodeApiKey',
    baseURL: 'https://opencode.ai/zen/v1',
    defaultModels: [
      { alias: 'opencode-big-pickle', id: 'big-pickle', label: 'Big Pickle' },
      { alias: 'opencode-deepseek-v4-flash', id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    ],
  },
  {
    id: 'cloudflare-workers-ai',
    label: 'Cloudflare Workers AI',
    description: 'Cloudflare Workers AI models through the account-scoped OpenAI-compatible endpoint.',
    transport: 'openai-compatible',
    envVar: 'CLOUDFLARE_API_KEY',
    apiKeySettingKey: 'cloudflareApiKey',
    baseURL: 'https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1',
    requiresCloudflareAccountId: true,
    defaultModels: [
      { alias: 'cf-llama-3.3-70b', id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B Instruct fp8 Fast' },
      { alias: 'cf-gemma-4-26b', id: '@cf/google/gemma-4-26b-a4b-it', label: 'Gemma 4 26B A4B IT' },
    ],
  },
  {
    id: 'xiaomi',
    label: 'Xiaomi MiMo',
    description: 'Xiaomi MiMo models through the OpenAI-compatible API billing endpoint.',
    transport: 'openai-compatible',
    envVar: 'XIAOMI_API_KEY',
    apiKeySettingKey: 'xiaomiApiKey',
    baseURL: 'https://api.xiaomimimo.com/v1',
    defaultModels: [
      { alias: 'mimo-v2.5-pro', id: 'mimo-v2.5-pro', label: 'MiMo-V2.5-Pro' },
      { alias: 'mimo-v2-flash', id: 'mimo-v2-flash', label: 'MiMo-V2-Flash' },
    ],
  },
];

export function getPiCompatibleProviderDefinition(providerId: string): PiCompatibleProviderDefinition | undefined {
  return PI_COMPATIBLE_PROVIDERS.find((provider) => provider.id === providerId);
}
