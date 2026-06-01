export interface WorkerDashboardUiContract {
  version: 1;
  classes: {
    surface: string;
    grid: string;
    panel: string;
    panelHead: string;
    panelKicker: string;
    detailBody: string;
    detailGrid: string;
    detailBlock: string;
    field: string;
    actions: string;
    button: string;
    primaryButton: string;
    dangerButton: string;
    statusPill: string;
    emptyState: string;
    timeline: string;
    timelineEvent: string;
    stepHeader: string;
    muted: string;
  };
  cx: (...parts: Array<string | false | null | undefined>) => string;
  statusTone: (tone: 'good' | 'warning' | 'info' | 'muted' | 'error') => string;
}

export const workerDashboardUi: WorkerDashboardUiContract = {
  version: 1,
  classes: {
    surface: 'bfrost-worker-surface',
    grid: 'bfrost-worker-grid',
    panel: 'bfrost-worker-panel panel',
    panelHead: 'bfrost-worker-panel-head panel-head',
    panelKicker: 'bfrost-worker-kicker panel-kicker',
    detailBody: 'bfrost-worker-detail detail-body',
    detailGrid: 'bfrost-worker-detail-grid detail-grid',
    detailBlock: 'bfrost-worker-detail-block detail-block',
    field: 'bfrost-worker-field field',
    actions: 'bfrost-worker-actions panel-actions wrap',
    button: 'bfrost-worker-button',
    primaryButton: 'bfrost-worker-button primary',
    dangerButton: 'bfrost-worker-button btn-danger',
    statusPill: 'bfrost-worker-status status-pill',
    emptyState: 'bfrost-worker-empty empty-state',
    timeline: 'bfrost-worker-timeline timeline',
    timelineEvent: 'bfrost-worker-timeline-event timeline-event',
    stepHeader: 'bfrost-worker-step-header',
    muted: 'bfrost-worker-muted footnote',
  },
  cx: (...parts) => parts.filter(Boolean).join(' '),
  statusTone: (tone) => `bfrost-worker-status status-pill ${tone}`,
};
