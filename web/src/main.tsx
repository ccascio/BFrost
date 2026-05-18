import React from 'react';
import ReactDOM from 'react-dom/client';
import * as jsxRuntime from 'react/jsx-runtime';
import App from './App';
import { registerDashboardView, unregisterDashboardViewsForWorker } from './workers/registry';
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
      registerDashboardView: typeof registerDashboardView;
      unregisterDashboardViewsForWorker: typeof unregisterDashboardViewsForWorker;
    };
  }
}

window.bfrost = {
  React,
  ReactDOM,
  jsxRuntime,
  registerDashboardView,
  unregisterDashboardViewsForWorker,
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
