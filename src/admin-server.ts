import { promises as fs, existsSync } from 'fs';
import path from 'path';
import http, { IncomingMessage, Server, ServerResponse } from 'http';
import { config } from './config';
import { listRegisteredApiRoutes } from './workers/registry';
import { HttpRouter } from './http/router';
import { readJsonBody, sendJson } from './http/responses';
import { registerCoreRoutes } from './admin-routes';
import { buildDashboardState } from './admin-dashboard-state';
import { isAdminAuthEnabled, isAuthenticated } from './admin-auth';
import { BadRequestError } from './admin-route';
import { handleAuthRoutes } from './http/routes/auth';
import { detach } from './process-lifecycle';

let server: Server | null = null;

export async function startAdminServer(): Promise<void> {
  if (server) {
    return;
  }

  server = http.createServer((req, res) => {
    detach(handleRequest(req, res), 'admin:handle-request');
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(config.adminPort, config.adminHost, () => {
      server!.off('error', reject);
      console.log(`[Admin] Dashboard available at http://${config.adminHost}:${config.adminPort}`);
      resolve();
    });
  });
}

export async function stopAdminServer(): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server!.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

  server = null;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const authEnabled = isAdminAuthEnabled();

    // Auth endpoints must precede the gate so login/logout remain reachable.
    if (await handleAuthRoutes(req, res, url, authEnabled)) return;

    if (authEnabled && url.pathname.startsWith('/api/') && !isAuthenticated(req)) {
      return sendJson(res, 401, { error: 'Authentication required', authRequired: true });
    }

    // Unified dispatch: core and worker routes share one router table per request
    // (rebuilt each time because workers toggle at runtime). Duplicate route
    // patterns fail registration so worker/core ownership conflicts are visible.
    if (await buildRequestRouter().dispatch(req, res, url)) return;
    if (req.method === 'GET') {
      return serveStatic(url.pathname, res);
    }
    return sendJson(res, 404, { error: 'Not found' });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof BadRequestError) {
      return sendJson(res, err.statusCode, { error: message });
    }
    console.error('[Admin] Request failed:', err);
    return sendJson(res, 500, { error: message });
  }
}

function buildRequestRouter(): HttpRouter {
  const workerRoutes = listRegisteredApiRoutes();
  const router = new HttpRouter();
  registerCoreRoutes(router);

  for (const route of workerRoutes) {
    router.add(route.method, route.path, async (rq, rs, ctx) => {
      const response = await route.handle({
        req: rq,
        url: ctx.url,
        readJsonBody,
        getDashboardState: buildDashboardState,
      });
      sendJson(rs, response.status, response.body);
    });
  }

  return router;
}

// The dashboard build lives next to the working directory in a repo checkout, but
// next to the compiled module when BFrost runs from an installed npm package
// (where cwd is the user's data home, e.g. ~/.bfrost).
let cachedFrontendDir: string | undefined;
function frontendDistDir(): string {
  if (!cachedFrontendDir) {
    const candidates = [
      path.join(process.cwd(), 'web/dist'),
      path.resolve(__dirname, '..', 'web', 'dist'),
    ];
    cachedFrontendDir =
      candidates.find((dir) => existsSync(path.join(dir, 'index.html'))) ?? candidates[0];
  }
  return cachedFrontendDir;
}

async function serveStatic(requestPath: string, res: ServerResponse): Promise<void> {
  const frontendDir = frontendDistDir();
  const assetPath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const normalized = path.normalize(assetPath);
  const resolved = path.resolve(frontendDir, normalized);

  if (!resolved.startsWith(path.resolve(frontendDir))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(resolved);
    if (stat.isFile()) {
      const body = await fs.readFile(resolved);
      res.writeHead(200, {
        'Content-Type': contentTypeFor(resolved),
        'Content-Length': body.length,
      });
      res.end(body);
      return;
    }
  } catch {
    // Fall through to index.html.
  }

  try {
    const indexHtml = await fs.readFile(path.join(frontendDir, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Frontend not found. Run "npm run build" to generate the React dashboard.');
  }
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}
