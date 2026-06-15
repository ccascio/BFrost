import type { IncomingMessage, ServerResponse } from 'http';
import type { z } from 'zod';
import { BadRequestError } from '../admin-route';

/**
 * Shared HTTP request/response helpers used by every admin route module and the
 * worker-ops layer. Kept dependency-free (no registry imports) so route modules
 * can depend on it without pulling the world in. See CODE_ROADMAP.md Phase 1.1.
 */

const DEFAULT_MAX_JSON_BYTES = 1024 * 1024;

export async function readJsonBody<TSchema extends z.ZodTypeAny>(
  req: IncomingMessage,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  const body = await readRawBody(req, DEFAULT_MAX_JSON_BYTES);
  const raw = body.length === 0 ? {} : parseJson(body.toString('utf8'));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError(`Invalid request body: ${formatZodError(parsed.error)}`);
  }

  return parsed.data;
}

export async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new BadRequestError(`Request body is too large; limit is ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
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
