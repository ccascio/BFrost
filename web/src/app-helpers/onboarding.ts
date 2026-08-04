export interface WorkerOnboardingActionLike {
  id: string;
  title: string;
  description: string;
  endpoint?: string;
  runJob?: string;
  navigateWorkerTab?: boolean;
  completedWhenHealthKey?: string;
  priority?: number;
}

export interface OnboardingWorkerLike {
  id: string;
  enabled: boolean;
  onboarding?: WorkerOnboardingActionLike;
  health?: Array<{ key: string; ok: boolean }>;
}

export interface OnboardingActionEntry extends WorkerOnboardingActionLike {
  workerId: string;
}

export function isOnboardingActionComplete(action: WorkerOnboardingActionLike, worker: OnboardingWorkerLike): boolean {
  if (!action.completedWhenHealthKey) return false;
  return worker.health?.some((row) => row.key === action.completedWhenHealthKey && row.ok) ?? false;
}

export function collectActiveOnboardingActions(dashboard: { workers: OnboardingWorkerLike[] }): OnboardingActionEntry[] {
  return dashboard.workers
    .filter((worker) => worker.onboarding && worker.enabled && !isOnboardingActionComplete(worker.onboarding, worker))
    .map((worker) => ({ ...(worker.onboarding as WorkerOnboardingActionLike), workerId: worker.id }))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

export function shouldAdvancePastWelcome(dashboard: { workers: OnboardingWorkerLike[] }): boolean {
  return dashboard.workers.some((worker) =>
    Boolean(worker.onboarding && worker.enabled && isOnboardingActionComplete(worker.onboarding, worker)),
  );
}
