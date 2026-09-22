import { useEffect, useState } from 'react';
import type { DashboardState, DashboardTab, WorkerOnboardingAction } from '../app-types';
import { toAppError } from '../app-types';

export function useOverviewController({
  dashboard,
  setActiveTab,
  setBusyKey,
  setError,
  setNotice,
  fetchDashboard,
}: {
  dashboard: DashboardState | null;
  setActiveTab: (tab: DashboardTab) => void;
  setBusyKey: (key: string | null) => void;
  setError: (error: ReturnType<typeof toAppError> | null) => void;
  setNotice: (notice: string) => void;
  fetchDashboard: (preserveDrafts: boolean) => Promise<void>;
}) {
  const [recipeExpanded, setRecipeExpanded] = useState<string | null>(null);
  const [recipeInputValues, setRecipeInputValues] = useState<Record<string, string>>({});
  const [recipeApplied, setRecipeApplied] = useState<Set<string>>(new Set());
  const [recipeApplying, setRecipeApplying] = useState(false);
  const [lmAdoptDismissed, setLmAdoptDismissed] = useState(false);
  const [lmAdopting, setLmAdopting] = useState(false);
  const [cloudConnectProvider, setCloudConnectProvider] = useState('');
  const [cloudConnectKey, setCloudConnectKey] = useState('');
  const [cloudConnecting, setCloudConnecting] = useState(false);
  const [cloudTestReply, setCloudTestReply] = useState<string | null>(null);
  const [firstResultJob, setFirstResultJob] = useState<{ label: string; summary: string; jobName: string } | null>(null);
  const [starAsk, setStarAsk] = useState(false);
  const firstResultShownKey = 'bfrost:first-result-shown';
  const starAskKey = 'bfrost:star-ask-shown';

  useEffect(() => {
    if (!firstResultJob) return;
    if (localStorage.getItem(starAskKey)) return;
    setStarAsk(true);
  }, [firstResultJob]);

  useEffect(() => {
    if (localStorage.getItem(firstResultShownKey)) return;
    const jobs = dashboard?.cron?.jobs ?? [];
    const hit = jobs.find(
      (job) => job.lastStatus === 'success' && job.lastSummary && job.lastFinishedAt,
    );
    if (hit) setFirstResultJob({ label: hit.label, summary: hit.lastSummary!, jobName: hit.name });
  }, [dashboard?.cron?.jobs]);

  const dismissStarAsk = () => {
    localStorage.setItem(starAskKey, '1');
    setStarAsk(false);
  };

  async function runDemoAction(action: WorkerOnboardingAction & { workerId: string }) {
    // Setup-style actions just route to the contributing worker's own tab (e.g. a
    // "connect" form). Core stays worker-agnostic — it only opens `worker:<id>`.
    if (action.navigateWorkerTab) {
      setActiveTab(`worker:${action.workerId}` as DashboardTab);
      return;
    }
    setActiveTab('overview');
    setBusyKey(`onboarding:${action.id}`);
    try {
      if (action.endpoint) {
        const res = await fetch(action.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: '{}',
        });
        if (!res.ok) throw new Error((await res.text()) || 'Request failed');
        const body = (await res.json().catch(() => ({}))) as { summary?: string };
        await fetchDashboard(true);
        setNotice(body.summary ?? 'Done — open Pipeline to see the items in the bus.');
      } else if (action.runJob) {
        const res = await fetch(`/api/cron-jobs/${encodeURIComponent(action.runJob)}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (!res.ok) throw new Error(await res.text());
        const body = (await res.json().catch(() => ({}))) as { queued?: boolean };
        setNotice(body.queued
          ? 'Queued… execution will begin when the current job finishes.'
          : 'Running… results will appear in the Pipeline and Jobs tabs in a moment.');
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await fetchDashboard(true);
        setNotice('Accepted — follow progress in Jobs and results in Pipeline.');
      }
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  return {
    runDemoAction,
    firstResultJob,
    firstResultShownKey,
    setFirstResultJob,
    lmAdoptDismissed,
    setLmAdoptDismissed,
    lmAdopting,
    setLmAdopting,
    starAsk,
    dismissStarAsk,
    cloudTestReply,
    setCloudTestReply,
    cloudConnectProvider,
    setCloudConnectProvider,
    cloudConnectKey,
    setCloudConnectKey,
    cloudConnecting,
    setCloudConnecting,
    recipeApplied,
    setRecipeApplied,
    recipeExpanded,
    setRecipeExpanded,
    recipeInputValues,
    setRecipeInputValues,
    recipeApplying,
    setRecipeApplying,
  };
}
