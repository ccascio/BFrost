import { execFile } from 'child_process';
import { constants } from 'fs';
import { access } from 'fs/promises';
import { promisify } from 'util';
import { config } from './config';
import { resolveTelegramBotToken } from './workers/builtin/channels-telegram/credentials';
import { resolveDiscordBotToken, resolveDiscordChannelId } from './workers/builtin/channels-discord/credentials';
import { getStoredEmailCredentials } from './workers/builtin/channels-email/credentials';

const execFileAsync = promisify(execFile);

export interface HealthStatus {
  ok: boolean;
  detail: string;
}

export interface AppHealthSnapshot {
  // Open-ended map: each entry is a health row contributed by a worker's
  // requiredCredentials/optionalCredentials (matched by `key`), or by a small
  // set of core-owned checks (cloud LLM providers, allowed-user gate). Don't
  // freeze the shape here — workers declare their own keys via their manifest.
  integrations: Record<string, HealthStatus>;
  dependencies: {
    lmStudioCli: HealthStatus;
    ffmpeg: HealthStatus;
    whisperCli: HealthStatus;
    whisperModel: HealthStatus;
    sqliteCli: HealthStatus;
    embeddingModelReachable: HealthStatus;
  };
}

async function fileReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK | constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function commandAvailable(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 5000 });
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code !== 'ENOENT';
  }
}

function configured(ok: boolean, readyDetail: string, missingDetail: string): HealthStatus {
  return {
    ok,
    detail: ok ? readyDetail : missingDetail,
  };
}

async function embeddingModelReachable(): Promise<boolean> {
  if (config.embeddingProvider === 'openai') {
    return Boolean(config.openaiApiKey);
  }
  try {
    const response = await fetch(`${config.ollamaBaseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.embeddingModel,
        input: 'health check',
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json() as { data?: Array<{ embedding?: unknown }> };
    return Array.isArray(data.data) && Array.isArray(data.data[0]?.embedding);
  } catch {
    return false;
  }
}

export async function getAppHealthSnapshot(): Promise<AppHealthSnapshot> {
  const [lmStudioCliOk, ffmpegOk, whisperCliOk, whisperModelOk, sqliteCliOk, embeddingModelOk, telegramBotToken, discordBotToken, discordChannelId, emailCreds] = await Promise.all([
    fileExecutable(config.lmStudioBin),
    commandAvailable('ffmpeg', ['-version']),
    commandAvailable('whisper-cli', ['--help']),
    fileReadable(config.whisperModelPath),
    commandAvailable('sqlite3', ['-version']),
    embeddingModelReachable(),
    resolveTelegramBotToken(),
    resolveDiscordBotToken(),
    resolveDiscordChannelId(),
    getStoredEmailCredentials(),
  ]);

  return {
    integrations: {
      telegramConfigured: configured(
        Boolean(telegramBotToken),
        'Telegram bot token present.',
        'Configure the Telegram bot token in the dashboard.',
      ),
      discordConfigured: configured(
        Boolean(discordBotToken && discordChannelId),
        'Discord bot token and channel ID present.',
        'Configure the Discord bot token and channel ID in the Channels tab.',
      ),
      emailConfigured: configured(
        Boolean(emailCreds.smtpHost && emailCreds.smtpUser && emailCreds.smtpPassword),
        'Email SMTP credentials present.',
        'Configure SMTP credentials in the Channels tab.',
      ),
      googleSearchConfigured: configured(
        Boolean(config.googleApiKey && config.googleSearchEngineId),
        'Google Custom Search credentials present.',
        'Set GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID to enable web search and digest jobs.',
      ),
      xConfigured: configured(
        Boolean(
          config.xConsumerKey &&
            config.xConsumerSecret &&
            config.xAccessToken &&
            config.xAccessTokenSecret,
        ),
        'X posting credentials present.',
        'Set the X_* credentials to enable automated posting.',
      ),
      allowedUserConfigured: configured(
        Boolean(config.allowedUserId),
        `Allowed Telegram user set to ${config.allowedUserId}.`,
        'Set ALLOWED_USER_ID to restrict bot usage to your Telegram account.',
      ),
      openaiConfigured: configured(
        Boolean(config.openaiApiKey),
        'OpenAI API key present.',
        'Set OPENAI_API_KEY to enable OpenAI model fallback.',
      ),
      anthropicConfigured: configured(
        Boolean(config.anthropicApiKey),
        'Anthropic API key present.',
        'Set ANTHROPIC_API_KEY to enable Claude model fallback.',
      ),
    },
    dependencies: {
      lmStudioCli: configured(
        lmStudioCliOk,
        `LM Studio CLI found at ${config.lmStudioBin}.`,
        `LM Studio CLI missing or not executable at ${config.lmStudioBin}.`,
      ),
      ffmpeg: configured(
        ffmpegOk,
        '`ffmpeg` is available in PATH.',
        '`ffmpeg` is missing from PATH. Voice transcription will fail.',
      ),
      whisperCli: configured(
        whisperCliOk,
        '`whisper-cli` is available in PATH.',
        '`whisper-cli` is missing from PATH. Voice transcription will fail.',
      ),
      whisperModel: configured(
        whisperModelOk,
        `Whisper model found at ${config.whisperModelPath}.`,
        `Whisper model file not found at ${config.whisperModelPath}.`,
      ),
      sqliteCli: configured(
        sqliteCliOk,
        '`sqlite3` is available in PATH.',
        '`sqlite3` is missing from PATH. Durable event history will fail.',
      ),
      embeddingModelReachable: configured(
        embeddingModelOk,
        config.embeddingProvider === 'openai'
          ? `Embedding model ${config.embeddingModel} via OpenAI (key configured).`
          : `Embedding model ${config.embeddingModel} is reachable at ${config.ollamaBaseUrl}.`,
        config.embeddingProvider === 'openai'
          ? `OpenAI API key not set. Configure it in Config → Cloud API keys.`
          : `Embedding model ${config.embeddingModel} is not reachable at ${config.ollamaBaseUrl}. Start the local embedding server or set OLLAMA_BASE_URL and EMBEDDING_MODEL.`,
      ),
    },
  };
}

export function assertStartupReadiness(health: AppHealthSnapshot): void {
  if (!health.dependencies.lmStudioCli.ok) {
    throw new Error(
      `${health.dependencies.lmStudioCli.detail} Set LMSTUDIO_BIN in .env to the correct local path.`,
    );
  }
}

export function logStartupHealthSummary(health: AppHealthSnapshot): void {
  const warnings = [
    ...Object.values(health.integrations),
    ...Object.values(health.dependencies).filter((item) => item.detail),
  ].filter((item) => !item.ok);

  if (warnings.length === 0) {
    console.log('[Health] Startup checks passed.');
    return;
  }

  console.warn('[Health] Startup warnings:');
  for (const warning of warnings) {
    console.warn(`- ${warning.detail}`);
  }
}
