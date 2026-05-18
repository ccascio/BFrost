import type { AdminApiRoute } from '../admin-route';
import type { BackendWorkerModule } from './module';
import type { WorkerManifest } from './types';

export class WorkerModuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerModuleValidationError';
  }
}

export function validateBackendWorkerModules(modules: BackendWorkerModule[]): void {
  const workerIds = new Set<string>();
  const jobIds = new Set<string>();
  const routes: AdminApiRoute[] = [];

  for (const module of modules) {
    const worker = module.manifest;
    validateWorkerManifest(worker);

    if (workerIds.has(worker.id)) {
      throw new WorkerModuleValidationError(`Duplicate worker id: ${worker.id}`);
    }
    workerIds.add(worker.id);

    for (const job of worker.jobs) {
      if (job.workerId !== worker.id) {
        throw new WorkerModuleValidationError(`Job ${job.id} declares workerId ${job.workerId}, expected ${worker.id}`);
      }
      if (jobIds.has(job.id)) {
        throw new WorkerModuleValidationError(`Duplicate job id: ${job.id}`);
      }
      jobIds.add(job.id);

      const parsedDefaults = job.paramsSchema.safeParse(job.defaultParams ?? {});
      if (!parsedDefaults.success) {
        throw new WorkerModuleValidationError(`Default params for job ${job.id} do not match its schema.`);
      }
      for (const field of job.dashboardFields) {
        if (!(field.key in (job.defaultParams ?? {}))) {
          throw new WorkerModuleValidationError(`Dashboard field ${field.key} is missing from default params for job ${job.id}`);
        }
      }
    }

    if (module.apiRoutes) {
      routes.push(...module.apiRoutes);
    }
  }

  validateAdminApiRoutes(routes, workerIds);
}

export function validateAdminApiRoutes(routes: AdminApiRoute[], workerIds: Iterable<string>): void {
  const knownWorkerIds = new Set(workerIds);
  const routeKeys = new Set<string>();

  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    if (routeKeys.has(key)) {
      throw new WorkerModuleValidationError(`Duplicate admin API route: ${key}`);
    }
    routeKeys.add(key);

    if (route.workerIds.length === 0) {
      throw new WorkerModuleValidationError(`Admin API route ${key} must declare at least one worker owner.`);
    }
    for (const workerId of route.workerIds) {
      if (!knownWorkerIds.has(workerId)) {
        throw new WorkerModuleValidationError(`Admin API route ${key} declares unknown worker owner ${workerId}`);
      }
    }
  }
}

function validateWorkerManifest(worker: WorkerManifest): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(worker.id)) {
    throw new WorkerModuleValidationError(`Invalid worker id: ${worker.id}`);
  }
  if (!worker.name.trim()) {
    throw new WorkerModuleValidationError(`Worker ${worker.id} is missing a name.`);
  }
  if (!worker.version.trim()) {
    throw new WorkerModuleValidationError(`Worker ${worker.id} is missing a version.`);
  }
  if (!worker.description.trim()) {
    throw new WorkerModuleValidationError(`Worker ${worker.id} is missing a description.`);
  }
}
