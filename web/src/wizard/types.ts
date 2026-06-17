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
  lmStudio: { running: boolean; loadedModels: string[]; loadedCount: number };
  platform: PlatformSettings;
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
