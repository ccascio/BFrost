import type { BackendWorkerModule } from '../../module';
import { controlWorker } from './manifest';

export const controlModule: BackendWorkerModule = {
  manifest: controlWorker,
};
