import crypto from 'crypto';
import https from 'https';
import { config } from '../../../config';
import { openWorkerKv } from '../../storage';

const API_URL = 'https://api.twitter.com/2/tweets';
const CREDS_KV_KEY = 'credentials';

interface StoredXCredentials {
  xConsumerKey?: string;
  xConsumerSecret?: string;
  xAccessToken?: string;
  xAccessTokenSecret?: string;
  xUsername?: string;
}

const kv = openWorkerKv('core.publisher.x');

export interface ResolvedXCredentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  username: string;
}

/**
 * Resolve X credentials. The dashboard form is the source of truth: values written by
 * the user land in the worker KV via `setStoredXCredentials`. `.env` (via `config.*`)
 * is only consulted as a fallback for first-boot bootstrap.
 */
export async function resolveXCredentials(): Promise<ResolvedXCredentials> {
  const stored = (await kv.get<StoredXCredentials>(CREDS_KV_KEY)) ?? {};
  return {
    consumerKey: stored.xConsumerKey?.trim() || config.xConsumerKey,
    consumerSecret: stored.xConsumerSecret?.trim() || config.xConsumerSecret,
    accessToken: stored.xAccessToken?.trim() || config.xAccessToken,
    accessTokenSecret: stored.xAccessTokenSecret?.trim() || config.xAccessTokenSecret,
    username: stored.xUsername?.trim() || config.xUsername,
  };
}

export async function setStoredXCredentials(values: StoredXCredentials): Promise<void> {
  const current = (await kv.get<StoredXCredentials>(CREDS_KV_KEY)) ?? {};
  const next: StoredXCredentials = { ...current };
  for (const key of Object.keys(values) as Array<keyof StoredXCredentials>) {
    const value = values[key];
    if (value !== undefined) next[key] = value;
  }
  await kv.set(CREDS_KV_KEY, next);
}

export class TweetPostError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
    message: string,
  ) {
    super(message);
  }

  isDuplicate(): boolean {
    if (this.statusCode !== 403) return false;
    // Catch wording variations: "duplicate content", "duplicate tweet", "duplicate Tweet", etc.
    return /\bduplicate\b/i.test(this.body);
  }
}

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function buildOAuthHeader(method: string, url: string, creds: ResolvedXCredentials): string {
  const params: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');

  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  params.oauth_signature = signature;

  return (
    'OAuth ' +
    Object.keys(params)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(params[k])}"`)
      .join(', ')
  );
}

export async function validateXConfig(): Promise<void> {
  const creds = await resolveXCredentials();
  const missing = [
    ['X_CONSUMER_KEY', creds.consumerKey],
    ['X_CONSUMER_SECRET', creds.consumerSecret],
    ['X_ACCESS_TOKEN', creds.accessToken],
    ['X_ACCESS_TOKEN_SECRET', creds.accessTokenSecret],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`Missing X credentials: ${missing.join(', ')}`);
  }
}

export interface PostedTweet {
  id: string;
  text: string;
}

export async function postTweet(text: string): Promise<PostedTweet> {
  const creds = await resolveXCredentials();
  const body = JSON.stringify({ text });
  const authorization = buildOAuthHeader('POST', API_URL, creds);

  return new Promise((resolve, reject) => {
    const req = https.request(
      API_URL,
      {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const respBody = Buffer.concat(chunks).toString();
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            try {
              const parsed = JSON.parse(respBody);
              if (!parsed?.data?.id) {
                reject(
                  new TweetPostError(status, respBody, 'Tweet posted but response missing data.id'),
                );
                return;
              }
              resolve({ id: String(parsed.data.id), text: String(parsed.data.text ?? text) });
            } catch (err) {
              reject(
                new TweetPostError(status, respBody, 'Tweet response was not JSON: ' + (err as Error).message),
              );
            }
          } else {
            reject(new TweetPostError(status, respBody, `X API error ${status}: ${respBody.slice(0, 300)}`));
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
