import { HttpRouter } from './http/router';
import { registerDashboardRoutes } from './http/routes/dashboard';
import { registerWorkerRoutes } from './http/routes/workers';
import { registerChatRoutes } from './http/routes/chat';
import { registerConfigRoutes } from './http/routes/config';
import { registerBackupRoutes } from './http/routes/backups';
import { registerAdminRoutes } from './http/routes/admin';
import { registerActionRoutes } from './http/routes/actions';
import { registerArtifactRoutes } from './http/routes/artifacts';

export function registerCoreRoutes(router: HttpRouter): void {
  registerDashboardRoutes(router);
  registerWorkerRoutes(router);
  registerChatRoutes(router);
  registerConfigRoutes(router);
  registerBackupRoutes(router);
  registerAdminRoutes(router);
  registerActionRoutes(router);
  registerArtifactRoutes(router);
}
