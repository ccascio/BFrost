import { useState } from 'react';

/**
 * Runtime-loaded dashboard view. BFrost bundles this file with esbuild and serves it
 * from `/api/workers/local.dashboard-view-example/dashboard.js`. The host page provides
 * React + ReactDOM + jsx-runtime via `window.bfrost`, so all `react` imports resolve to
 * the host's React instance — never bundle a duplicate React here.
 */
function ExampleView() {
  const [count, setCount] = useState(0);
  const ui = window.bfrost.ui;
  return (
    <section className={ui.classes.panel}>
      <div className={ui.classes.panelHead}>
        <div>
          <p className={ui.classes.panelKicker}>Runtime loaded</p>
          <h2>Example View</h2>
        </div>
        <span className={ui.statusTone('info')}>{count}</span>
      </div>
      <div className={ui.classes.detailBody}>
        <p>This UI lives in <code>workers/examples/dashboard-view/dashboard.tsx</code>.</p>
        <button className={ui.classes.primaryButton} type="button" onClick={() => setCount((value) => value + 1)}>
          Clicked {count} time{count === 1 ? '' : 's'}
        </button>
      </div>
    </section>
  );
}

window.bfrost.registerDashboardView({
  workerId: 'local.dashboard-view-example',
  kind: 'example',
  surfaceIds: ['dashboard-view-example-tab'],
  count: () => undefined,
  render: () => <ExampleView />,
});

declare global {
  interface Window {
    bfrost: {
      registerDashboardView: (view: any) => void;
      ui: {
        classes: Record<string, string>;
        cx: (...parts: Array<string | false | null | undefined>) => string;
        statusTone: (tone: 'good' | 'warning' | 'info' | 'muted' | 'error') => string;
      };
      [key: string]: any;
    };
  }
}
