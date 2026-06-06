import type { BackendWorkerModule } from '../../module';
import { documentsWorker } from './manifest';
import { documentsApiRoutes } from './routes';
import { reconcileOrphans } from './store';

export const documentsModule: BackendWorkerModule = {
  manifest: documentsWorker,
  apiRoutes: documentsApiRoutes,
  lifecycle: {
    // Drop any files left behind by projects deleted while the worker was off.
    async onEnable() {
      try {
        await reconcileOrphans();
      } catch (err) {
        console.warn('[Documents] Orphan reconciliation failed:', err);
      }
    },
  },
};

export { searchProjectDocuments, addFile, deleteFile, listFiles } from './store';
