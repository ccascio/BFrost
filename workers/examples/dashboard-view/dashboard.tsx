import { useState } from 'react';

/**
 * Runtime-loaded dashboard view. BFrost bundles this file with esbuild and serves it
 * from `/api/workers/local.dashboard-view-example/dashboard.js`. The host page provides
 * React + ReactDOM + jsx-runtime via `window.bfrost`, so all `react` imports resolve to
 * the host's React instance — never bundle a duplicate React here.
 */
function ExampleView() {
  const [count, setCount] = useState(0);
  return (
    <section style={{ padding: '1rem' }}>
      <h2>Example View (runtime-loaded worker)</h2>
      <p>This UI lives in <code>workers/examples/dashboard-view/dashboard.tsx</code>.</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Clicked {count} time{count === 1 ? '' : 's'}
      </button>
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
      [key: string]: any;
    };
  }
}
