import { z } from 'zod';
import type { AdminApiRoute } from '../../../admin-route';
import { recordEventSafe } from '../../../event-log';
import { saveResearchSettings } from './job';

const ResearchSettingsBodySchema = z.object({
  topics: z.array(z.string()).optional(),
}).strict();

export const researchApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/research/settings',
    workerIds: ['core.research'],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, ResearchSettingsBodySchema);
      const settings = await saveResearchSettings({
        topics: body.topics ?? [],
      });
      await recordEventSafe({
        category: 'research',
        action: 'settings_updated',
        summary: `Research topics updated (${settings.topics.length}).`,
        metadata: {
          workerId: 'core.research',
          workerName: 'Research',
          topics: settings.topics,
        },
      });
      return { status: 200, body: { ok: true } };
    },
  },
];
