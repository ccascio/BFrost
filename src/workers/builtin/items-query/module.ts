import type { BackendWorkerModule } from '../../module';
import { itemsQueryWorker } from './manifest';

export const itemsQueryModule: BackendWorkerModule = {
  manifest: itemsQueryWorker,
};
