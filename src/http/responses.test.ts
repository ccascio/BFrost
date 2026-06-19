import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import { z } from 'zod';
import { BadRequestError } from '../admin-route';
import { readJsonBody, readRawBody } from './responses';

function requestWithBody(
  body: string | Buffer,
  headers: IncomingMessage['headers'] = {},
): IncomingMessage {
  const req = Readable.from([body]) as IncomingMessage;
  req.headers = headers;
  return req;
}

test('readJsonBody accepts JSON media types and validates the parsed body', async () => {
  const body = await readJsonBody(
    requestWithBody(JSON.stringify({ name: 'BFrost' }), {
      'content-type': 'application/vnd.bfrost+json; charset=utf-8',
      'content-length': String(Buffer.byteLength(JSON.stringify({ name: 'BFrost' }))),
    }),
    z.object({ name: z.string() }).strict(),
  );

  assert.deepEqual(body, { name: 'BFrost' });
});

test('readJsonBody rejects non-JSON request bodies with 415', async () => {
  await assert.rejects(
    readJsonBody(
      requestWithBody('{"name":"BFrost"}', {
        'content-type': 'text/plain',
        'content-length': '17',
      }),
      z.object({ name: z.string() }).strict(),
    ),
    (err) => {
      assert.ok(err instanceof BadRequestError);
      assert.equal(err.statusCode, 415);
      assert.match(err.message, /Unsupported Content-Type/);
      return true;
    },
  );
});

test('readJsonBody allows an empty body without a content type', async () => {
  const body = await readJsonBody(
    requestWithBody('', {}),
    z.object({}).strict(),
  );

  assert.deepEqual(body, {});
});

test('readRawBody reports oversized bodies with 413', async () => {
  await assert.rejects(
    readRawBody(requestWithBody('abc', { 'content-length': '3' }), { maxBytes: 2 }),
    (err) => {
      assert.ok(err instanceof BadRequestError);
      assert.equal(err.statusCode, 413);
      assert.match(err.message, /too large/);
      return true;
    },
  );
});

test('readRawBody can require explicit upload media types', async () => {
  await assert.rejects(
    readRawBody(requestWithBody('', {}), {
      maxBytes: 1024,
      acceptedContentTypes: ['application/zip'],
      requireContentType: true,
    }),
    (err) => {
      assert.ok(err instanceof BadRequestError);
      assert.equal(err.statusCode, 415);
      return true;
    },
  );
});
