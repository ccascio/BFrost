import type { BackendWorkerModule } from '../../module';
import { emailChannelWorker } from './manifest';
import { createEmailChannelAdapter } from './adapter';
import { emailChannelApiRoutes } from './routes';

export const emailChannelModule: BackendWorkerModule = {
  manifest: emailChannelWorker,
  apiRoutes: emailChannelApiRoutes,
  channelAdapters: [
    {
      channelId: 'email',
      create: createEmailChannelAdapter,
    },
  ],
};
