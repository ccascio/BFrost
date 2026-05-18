import type { BackendWorkerModule } from '../../module';
import { telegramChannelWorker } from './manifest';
import { createTelegramChannelAdapter } from './adapter';
import { telegramChannelApiRoutes } from './routes';

export const telegramChannelModule: BackendWorkerModule = {
  manifest: telegramChannelWorker,
  apiRoutes: telegramChannelApiRoutes,
  channelAdapters: [
    {
      channelId: 'telegram',
      create: createTelegramChannelAdapter,
    },
  ],
};
