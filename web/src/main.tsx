import React from 'react';
import ReactDOM from 'react-dom/client';
import * as jsxRuntime from 'react/jsx-runtime';
import App from './App';
import { UiDemo } from './ui';
import { registerDashboardView, unregisterDashboardViewsForWorker } from './workers/registry';
import { workerDashboardUi, type WorkerDashboardUiContract } from './workers/ui-contract';
import './styles.css';

// Expose the host's React + helpers as a global so runtime-loaded worker dashboard
// bundles can build against `react` / `react/jsx-runtime` without bundling a second
// React (two Reacts would silently break hooks). The esbuild worker in
// `src/workers/build.ts` rewrites those imports to read from this global.
declare global {
  interface Window {
    bfrost: {
      React: typeof React;
      ReactDOM: typeof ReactDOM;
      jsxRuntime: typeof jsxRuntime;
      ui: WorkerDashboardUiContract;
      registerDashboardView: typeof registerDashboardView;
      unregisterDashboardViewsForWorker: typeof unregisterDashboardViewsForWorker;
    };
  }
}

window.bfrost = {
  React,
  ReactDOM,
  jsxRuntime,
  ui: workerDashboardUi,
  registerDashboardView,
  unregisterDashboardViewsForWorker,
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has('ui-demo') ? <UiDemo /> : <App />}
  </React.StrictMode>,
);
