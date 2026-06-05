import type { BackendWorkerModule } from '../../module';
import { shellWorker } from './manifest';
import { shellApiRoutes } from './routes';
import { loadPolicy, type ShellPolicy } from './policy';

export interface ShellWorkerDashboardData {
  /** Seeds the Config form's `seedPath: core.shell.policy.*` fields with live values. */
  policy: ShellPolicy;
}

export const shellModule: BackendWorkerModule<ShellWorkerDashboardData> = {
  manifest: shellWorker,
  apiRoutes: shellApiRoutes,
  async loadDashboardData() {
    return { policy: await loadPolicy() };
  },
};
