import type { BackendWorkerModule } from '../../module';
import { catalogManifest } from './manifest';

export const catalogModule: BackendWorkerModule = {
  manifest: catalogManifest,
};
