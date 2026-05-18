import type { AdminApiRoute } from '../../admin-route';
import { builtInWorkerModules } from './index';
import { validateAdminApiRoutes } from '../validation';

export const builtInWorkerApiRoutes: AdminApiRoute[] = builtInWorkerModules.flatMap(
  (module) => module.apiRoutes ?? [],
);

validateAdminApiRoutes(
  builtInWorkerApiRoutes,
  builtInWorkerModules.map((module) => module.manifest.id),
);
