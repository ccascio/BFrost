import type { IncomingMessage, ServerResponse } from 'http';

/**
 * A tiny, dependency-free HTTP router.
 *
 * It exists so the admin server stops being a ~900-line `if (pathname === … &&
 * method === …)` ladder and instead owns a *mechanism* that both core endpoints
 * and worker `apiRoutes` register into the same way — the worker-first contract
 * applied to HTTP routing. See CODE_ROADMAP.md Phase 1.1.
 *
 * Path syntax: literal segments plus `:name` params, e.g. `/api/workers/:id/enable`.
 * Params are URL-decoded. Routes are matched most-specific-first (more literal
 * segments win), so `/api/workers/rescan` is preferred over `/api/workers/:id`.
 */

export interface RouteContext {
  url: URL;
  params: Record<string, string>;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
) => void | Promise<void>;

type Segment = { kind: 'literal'; value: string } | { kind: 'param'; name: string };

interface CompiledRoute {
  method: string;
  segments: Segment[];
  literalCount: number;
  handler: RouteHandler;
}

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter((part) => part.length > 0);
}

function compilePath(path: string): { segments: Segment[]; literalCount: number } {
  const segments: Segment[] = [];
  let literalCount = 0;
  for (const part of splitPath(path)) {
    if (part.startsWith(':')) {
      segments.push({ kind: 'param', name: part.slice(1) });
    } else {
      segments.push({ kind: 'literal', value: part });
      literalCount += 1;
    }
  }
  return { segments, literalCount };
}

export class HttpRouter {
  private routes: CompiledRoute[] = [];
  // Canonical pattern per registered route: METHOD + per-segment tokens where
  // literals are "L:value" and params collapse to "P" (name ignored, so
  // :id and :userId are treated as the same slot).
  private patternSigs = new Set<string>();

  private patternKey(method: string, segments: Segment[]): string {
    return method + ':' + segments.map((s) => (s.kind === 'literal' ? `L:${s.value}` : 'P')).join('/');
  }

  /** Register a route. Chainable. Re-sorts so the most specific route matches first. */
  add(method: string, path: string, handler: RouteHandler): this {
    const { segments, literalCount } = compilePath(path);
    const sig = this.patternKey(method.toUpperCase(), segments);
    if (this.patternSigs.has(sig)) {
      throw new Error(`Duplicate route: ${method.toUpperCase()} ${path}`);
    }
    this.patternSigs.add(sig);
    this.routes.push({ method: method.toUpperCase(), segments, literalCount, handler });
    // Most literal segments first → exact routes beat param routes of equal length.
    // Stable enough: ties keep registration order.
    this.routes.sort((a, b) => b.literalCount - a.literalCount);
    return this;
  }

  /** Find the handler + extracted params for a method/path, or null. */
  match(method: string, pathname: string): { handler: RouteHandler; params: Record<string, string> } | null {
    const wanted = method.toUpperCase();
    const parts = splitPath(pathname);
    for (const route of this.routes) {
      if (route.method !== wanted) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        const part = parts[i];
        if (seg.kind === 'literal') {
          if (seg.value !== part) {
            ok = false;
            break;
          }
        } else {
          params[seg.name] = decodeURIComponent(part);
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }

  /**
   * Dispatch a request. Returns true if a route matched and its handler ran;
   * false if no route matched (caller handles the fallthrough — static files, 404).
   * Handler errors propagate to the caller's error envelope.
   */
  async dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const found = this.match(req.method ?? 'GET', url.pathname);
    if (!found) return false;
    await found.handler(req, res, { url, params: found.params });
    return true;
  }
}
