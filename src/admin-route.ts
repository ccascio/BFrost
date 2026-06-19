import type { IncomingMessage } from 'http';
import type { z } from 'zod';
import type { DashboardState } from './admin-api';

export class BadRequestError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'BadRequestError';
    this.statusCode = statusCode;
  }
}

export interface AdminJsonResponse {
  status: number;
  body: unknown;
}

export interface AdminRouteContext {
  req: IncomingMessage;
  url: URL;
  readJsonBody: <TSchema extends z.ZodTypeAny>(
    req: IncomingMessage,
    schema: TSchema,
  ) => Promise<z.infer<TSchema>>;
  getDashboardState: () => Promise<DashboardState>;
}

export interface AdminApiRoute {
  method: string;
  path: string;
  workerIds: string[];
  handle: (context: AdminRouteContext) => Promise<AdminJsonResponse>;
}
