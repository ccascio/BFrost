import type { DashboardTab, SettingsTab } from '../app-types';

const SETTINGS_SECTIONS: Record<string, SettingsTab> = {
  actions: 'actions',
  channels: 'channels',
  platform: 'config',
  config: 'config',
  settings: 'config',
  system: 'system',
  workers: 'workers',
};

export interface DashboardRouteState {
  activeTab: DashboardTab;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
}

export function readDashboardRoute(): DashboardRouteState {
  if (typeof window === 'undefined') {
    return defaultRouteState();
  }
  return routeStateFromPath(window.location.pathname);
}

export function defaultRouteState(): DashboardRouteState {
  return {
    activeTab: 'overview',
    settingsOpen: false,
    settingsTab: 'config',
  };
}

export function routeStateFromPath(pathname: string): DashboardRouteState {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const fallback = defaultRouteState();

  if (parts.length === 0 || parts[0] === 'overview' || parts[0] === 'pipeline') {
    return fallback;
  }

  if (parts.length === 1) {
    if (parts[0] === 'jobs') return { ...fallback, activeTab: 'jobs' };
    if (parts[0] === 'store') return { ...fallback, activeTab: 'store' };
    if (parts[0] === 'health') return { ...fallback, activeTab: 'health' };
    if (parts[0] === 'chat') return { ...fallback, activeTab: 'chat' };
  }

  if (parts[0] === 'workers' && parts[1]) {
    const workerId = parts[1];
    if (parts[2] === 'config' || parts[2] === 'settings') {
      return { ...fallback, activeTab: `worker-config:${workerId}` };
    }
    return { ...fallback, activeTab: `worker:${workerId}` };
  }

  if (parts[0] === 'config') {
    if (parts[1] === 'workers' && parts[2]) {
      return {
        activeTab: fallback.activeTab,
        settingsOpen: true,
        settingsTab: `worker-settings:${parts[2]}`,
      };
    }
    const section = SETTINGS_SECTIONS[parts[1] ?? 'platform'] ?? 'config';
    return {
      activeTab: fallback.activeTab,
      settingsOpen: true,
      settingsTab: section,
    };
  }

  return fallback;
}

export function pathForDashboardTab(tab: DashboardTab): string {
  if (tab === 'overview' || tab === 'pipeline') return '/';
  if (tab === 'jobs') return '/jobs';
  if (tab === 'store') return '/store';
  if (tab === 'health') return '/health';
  if (tab === 'chat') return '/chat';
  if (tab === 'channels' || tab === 'workers' || tab === 'config' || tab === 'system' || tab === 'actions') {
    return pathForSettingsTab(tab);
  }
  if (tab.startsWith('worker-config:')) {
    return `/workers/${encodeURIComponent(tab.slice('worker-config:'.length))}/config`;
  }
  if (tab.startsWith('worker:')) {
    return `/workers/${encodeURIComponent(tab.slice('worker:'.length))}`;
  }
  return '/';
}

export function pathForSettingsTab(tab: SettingsTab): string {
  if (tab === 'config') return '/config/platform';
  if (tab.startsWith('worker-settings:')) {
    return `/config/workers/${encodeURIComponent(tab.slice('worker-settings:'.length))}`;
  }
  return `/config/${tab}`;
}

export function pushDashboardPath(path: string): void {
  if (typeof window === 'undefined') return;
  const next = withCurrentQuery(path);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === next) return;
  window.history.pushState({}, '', next);
}

function withCurrentQuery(path: string): string {
  if (typeof window === 'undefined') return path;
  const query = window.location.search;
  const hash = window.location.hash;
  return `${path}${query}${hash}`;
}
