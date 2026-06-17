import type { IncomingMessage, ServerResponse } from 'http';
import { AdminLoginBodySchema } from '../../admin-api';
import { readJsonBody, sendJson } from '../responses';
import {
  isAdminAuthEnabled,
  isAuthenticated,
  isPasswordValid,
  createSession,
  destroySession,
} from '../../admin-auth';

// Returns true if the request was handled (caller should stop processing).
// Must be called before any authentication gate so login/logout remain reachable.
export async function handleAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  authEnabled: boolean,
): Promise<boolean> {
  if (url.pathname === '/api/auth/session' && req.method === 'GET') {
    sendJson(res, 200, { authenticated: authEnabled ? isAuthenticated(req) : true, authEnabled });
    return true;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    if (!authEnabled) {
      sendJson(res, 200, { authenticated: true, authEnabled: false });
      return true;
    }
    const body = await readJsonBody(req, AdminLoginBodySchema);
    if (!isPasswordValid(body.password)) {
      sendJson(res, 401, { error: 'Invalid password' });
      return true;
    }
    createSession(res);
    sendJson(res, 200, { authenticated: true, authEnabled: true });
    return true;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    destroySession(req, res);
    sendJson(res, 200, { authenticated: false, authEnabled });
    return true;
  }

  return false;
}
