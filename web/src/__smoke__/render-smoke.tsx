// Frontend render smoke: mounts components with mock props via react-dom/server
// and reports any that throw during render. This is the safety net for the App.tsx
// per-tab split (CODE_ROADMAP Phase 1.2) — vite/tsc cannot catch a mis-wired prop
// that only blows up at render time; this can. Run via `npm run smoke:web`.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
import {
  Metric,
  Detail,
  DetailBlock,
  HelpTip,
  HealthRow,
  StoreTrustBadge,
  StatusPill,
  RunError,
} from '../app-helpers';

interface SmokeCase {
  name: string;
  el: ReactElement;
}

// Render-only smoke: each case must produce markup without throwing.
const cases: SmokeCase[] = [
  { name: 'Metric', el: createElement(Metric, { label: 'Queued', value: '3' }) },
  { name: 'Detail', el: createElement(Detail, { label: 'Model', value: 'local' }) },
  { name: 'DetailBlock', el: createElement(DetailBlock, { label: 'Notes', value: 'hello world' }) },
  { name: 'HelpTip', el: createElement(HelpTip, { children: 'help text' }) },
  {
    name: 'HealthRow',
    el: createElement(HealthRow, { label: 'API', status: { ok: true, detail: 'reachable' } }),
  },
  { name: 'StoreTrustBadge', el: createElement(StoreTrustBadge, { trust: 'community' }) },
  { name: 'StatusPill', el: createElement(StatusPill, { tone: 'good', children: 'OK' }) },
  { name: 'RunError', el: createElement(RunError, { message: 'boom' }) },
];

export interface SmokeResult {
  name: string;
  ok: boolean;
  error?: string;
}

export function runSmoke(): SmokeResult[] {
  return cases.map(({ name, el }) => {
    try {
      const markup = renderToStaticMarkup(el);
      if (typeof markup !== 'string') throw new Error('no markup produced');
      return { name, ok: true };
    } catch (err) {
      return { name, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
