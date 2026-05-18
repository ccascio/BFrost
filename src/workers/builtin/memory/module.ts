import type { BackendWorkerModule } from '../../module';
import { memoryWorker } from './manifest';

export const memoryModule: BackendWorkerModule = {
  manifest: memoryWorker,
};

export { saveMemory, searchMemory } from './store';
