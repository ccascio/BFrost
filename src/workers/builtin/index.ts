import { newsModule } from './news/module';
import { xPublisherModule } from './publisher-x/module';
import { researchModule } from './research/module';
import { telegramChannelModule } from './channels-telegram/module';
import { memoryModule } from './memory/module';
import { searchGoogleModule } from './search-google/module';
import { articleFetchModule } from './article-fetch/module';
import { lmStudioProviderModule } from './providers-lmstudio/module';
import type { BackendWorkerModule } from '../module';
import type { WorkerManifest } from '../types';
import { validateBackendWorkerModules } from '../validation';

const modules: BackendWorkerModule[] = [
  newsModule,
  xPublisherModule,
  researchModule,
  telegramChannelModule,
  memoryModule,
  searchGoogleModule,
  articleFetchModule,
  lmStudioProviderModule,
];

validateBackendWorkerModules(modules);

export const builtInWorkerModules: BackendWorkerModule[] = modules;

export const builtInWorkers: WorkerManifest[] = builtInWorkerModules.map((module) => module.manifest);
