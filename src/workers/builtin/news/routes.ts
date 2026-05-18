import { SourceQualityRulesSchema } from '../../../admin-api';
import type { AdminApiRoute } from '../../../admin-route';
import { recordEventSafe } from '../../../event-log';
import { saveSourceQualityRules } from './source-quality';

export const newsApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/source-rules',
    workerIds: ['core.news'],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, SourceQualityRulesSchema);
      const rules = await saveSourceQualityRules(body);
      await recordEventSafe({
        category: 'source',
        action: 'rules_updated',
        summary: 'Source quality rules updated.',
        metadata: {
          workerId: 'core.news',
          workerName: 'News',
          minScore: rules.minScore,
          allowHosts: rules.allowHosts.length,
          blockHosts: rules.blockHosts.length,
          preferredHosts: rules.preferredHosts.length,
          lowQualityHosts: rules.lowQualityHosts.length,
        },
      });
      return { status: 200, body: { ok: true } };
    },
  },
];

