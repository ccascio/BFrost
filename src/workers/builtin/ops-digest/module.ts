import type { BackendWorkerModule } from '../../module';
import { opsDigestWorker } from './manifest';

export const opsDigestModule: BackendWorkerModule = {
  manifest: opsDigestWorker,
};
