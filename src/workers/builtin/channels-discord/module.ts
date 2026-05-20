import type { BackendWorkerModule } from '../../module';
import { discordChannelWorker } from './manifest';
import { createDiscordChannelAdapter } from './adapter';
import { discordChannelApiRoutes } from './routes';

export const discordChannelModule: BackendWorkerModule = {
  manifest: discordChannelWorker,
  apiRoutes: discordChannelApiRoutes,
  channelAdapters: [
    {
      channelId: 'discord',
      create: createDiscordChannelAdapter,
    },
  ],
};
