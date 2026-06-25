export type WorkerKind = 'feature' | 'channel' | 'provider';
export type WorkerHealthState =
  | 'healthy'
  | 'degraded'
  | 'missing'
  | 'unconfigured'
  | 'missing_credentials'
  | 'missing_dependency'
  | 'disabled';

export interface WorkerOnboardingAction {
  id: string;
  title: string;
  description: string;
  endpoint?: string;
  runJob?: string;
  priority?: number;
}

export interface WorkerSummary {
  id: string;
  name: string;
  displayName?: string;
  tagline?: string;
  description: string;
  kind: WorkerKind;
  builtIn: boolean;
  deletable?: boolean;
  enabled: boolean;
  missing: boolean;
  healthState: WorkerHealthState;
  healthDetail: string;
  jobCount: number;
  enabledJobCount: number;
  onboarding?: WorkerOnboardingAction;
  health?: Array<{ key: string; label: string; ok: boolean }>;
  dashboard?: WorkerDashboardManifest;
  providers?: WorkerProviderSummary[];
}

export interface WorkerProviderSummary {
  id: string;
  label: string;
  description: string;
  capabilities: {
    chat: boolean;
    embeddings: boolean;
    vision: boolean;
    localRuntime: boolean;
  };
}

export type WorkerDashboardField =
  | {
      type: 'text' | 'textarea' | 'secret-reference';
      key: string;
      label: string;
      defaultValue: string;
      group?: string;
      placeholder?: string;
      helpText?: string;
    }
  | {
      type: 'number';
      key: string;
      label: string;
      defaultValue: number;
      group?: string;
      helpText?: string;
    }
  | {
      type: 'boolean';
      key: string;
      label: string;
      defaultValue: boolean;
      group?: string;
      helpText?: string;
    }
  | {
      type: 'select';
      key: string;
      label: string;
      defaultValue: string;
      options: Array<{ label: string; value: string }>;
      group?: string;
      helpText?: string;
    }
  | {
      type: 'string-list';
      key: string;
      label: string;
      defaultValue: string[];
      group?: string;
      helpText?: string;
    }
  | {
      type: 'action';
      key: string;
      label: string;
      actionPath: string;
      group?: string;
      method?: 'POST' | 'GET';
      buttonLabel?: string;
      openInPopup?: boolean;
      enabledWhen?: { field: string; equals: string };
      disabled?: boolean;
      disabledReason?: string;
      helpText?: string;
    };

export interface WorkerDashboardSurface {
  id: string;
  label: string;
  description: string;
  path?: string;
  tab?: string;
  fieldGroups?: Array<{ id: string; label: string; description?: string }>;
  fields?: WorkerDashboardField[];
}

export interface WorkerDashboardManifest {
  settings: WorkerDashboardSurface[];
  routes: WorkerDashboardSurface[];
}

export interface SchedulerJobState {
  name: string;
  label: string;
  workerId: string;
  workerEnabled: boolean;
  enabled: boolean;
  running: boolean;
  lastStartedAt: string | null;
  lastStatus: 'idle' | 'success' | 'error' | 'skipped';
  lastSummary: string | null;
  lastError: string | null;
}

export interface IntegrationStatus {
  ok: boolean;
  label?: string;
}

export interface PlatformSettings {
  embeddingProvider: string;
  embeddingModel: string;
  adminPasswordSet: boolean;
  localWorkerCodeEnabled: boolean;
  adminSessionTtlHours: number;
  jobLlmTimeoutMs: number;
}

export interface DashboardSnapshot {
  workers: WorkerSummary[];
  cron: { jobs: SchedulerJobState[] };
  integrations: Record<string, IntegrationStatus>;
  localRuntime: { running: boolean; loadedModels: string[]; loadedCount: number };
  platform: PlatformSettings;
  workerData?: Record<string, unknown>;
  dependencies?: { embeddingModelReachable?: { ok: boolean } };
}

export interface WizardProps {
  dashboard: DashboardSnapshot;
  onDismiss: () => void;
  onComplete: () => void;
  onRefreshDashboard: () => Promise<void>;
  onNavigate: (tab: string) => void;
  onRunDemoAction?: (action: { workerId: string; id: string; endpoint?: string; runJob?: string }) => void;
}

export interface OnboardingActionEntry extends WorkerOnboardingAction {
  workerId: string;
}
