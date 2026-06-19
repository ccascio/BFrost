import type { IncomingMessage, ServerResponse } from 'http';
import type { z } from 'zod';
import { BadRequestError } from '../admin-route';

/**
 * Shared HTTP request/response helpers used by every admin route module and the
 * worker-ops layer. Kept dependency-free (no registry imports) so route modules
 * can depend on it without pulling the world in. See CODE_ROADMAP.md Phase 1.1.
 */

const DEFAULT_MAX_JSON_BYTES = 1024 * 1024;
const JSON_CONTENT_TYPES = ['application/json', 'application/*+json'] as const;

export interface ReadJsonBodyOptions {
  maxBytes?: number;
}

export interface ReadRawBodyOptions {
  maxBytes: number;
  acceptedContentTypes?: readonly string[];
  requireContentType?: boolean;
}

export async function readJsonBody<TSchema extends z.ZodTypeAny>(
  req: IncomingMessage,
  schema: TSchema,
  options: ReadJsonBodyOptions = {},
): Promise<z.infer<TSchema>> {
  const body = await readRawBody(req, {
    maxBytes: options.maxBytes ?? DEFAULT_MAX_JSON_BYTES,
    acceptedContentTypes: JSON_CONTENT_TYPES,
  });
  const raw = body.length === 0 ? {} : parseJson(body.toString('utf8'));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError(`Invalid request body: ${formatZodError(parsed.error)}`);
  }

  return parsed.data;
}

export async function readRawBody(
  req: IncomingMessage,
  maxBytesOrOptions: number | ReadRawBodyOptions,
): Promise<Buffer> {
  const options = typeof maxBytesOrOptions === 'number'
    ? { maxBytes: maxBytesOrOptions }
    : maxBytesOrOptions;
  assertRequestContentType(req, options, bodyIsKnownPresent(req));

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > options.maxBytes) {
      throw new BadRequestError(`Request body is too large; limit is ${formatByteLimit(options.maxBytes)}.`, 413);
    }
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks);
  assertRequestContentType(req, options, body.length > 0);
  return body;
}

export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new BadRequestError(`Malformed JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
}

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function bodyIsKnownPresent(req: IncomingMessage): boolean {
  const contentLength = req.headers['content-length'];
  if (typeof contentLength === 'string') {
    return Number(contentLength) > 0;
  }
  return req.headers['transfer-encoding'] !== undefined;
}

function assertRequestContentType(
  req: IncomingMessage,
  options: ReadRawBodyOptions,
  bodyPresent: boolean,
): void {
  const accepted = options.acceptedContentTypes;
  if (!accepted || accepted.length === 0) {
    return;
  }
  if (!options.requireContentType && !bodyPresent && req.headers['content-type'] === undefined) {
    return;
  }

  const actual = normalizedContentType(req.headers['content-type']);
  if (actual && accepted.some((candidate) => contentTypeMatches(actual, candidate))) {
    return;
  }

  const received = actual ? `"${actual}"` : 'no Content-Type';
  throw new BadRequestError(
    `Unsupported Content-Type: received ${received}; expected ${accepted.join(', ')}.`,
    415,
  );
}

function normalizedContentType(value: IncomingMessage['headers']['content-type']): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const type = raw?.split(';', 1)[0]?.trim().toLowerCase();
  return type && type.length > 0 ? type : null;
}

function contentTypeMatches(actual: string, expected: string): boolean {
  if (expected === 'application/*+json') {
    return actual.startsWith('application/') && actual.endsWith('+json');
  }
  return actual === expected.toLowerCase();
}

function formatByteLimit(maxBytes: number): string {
  const mb = 1024 * 1024;
  const kb = 1024;
  if (maxBytes % mb === 0) {
    return `${maxBytes / mb} MB`;
  }
  if (maxBytes % kb === 0) {
    return `${maxBytes / kb} KB`;
  }
  return `${maxBytes} bytes`;
}
