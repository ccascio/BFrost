import { HttpRouter } from '../router';
import { readJsonBody, sendJson } from '../responses';
import { listArtifacts, upsertArtifact, deleteArtifact } from '../../artifacts';
import { BadRequestError } from '../../admin-route';
import { z } from 'zod';

const UpsertArtifactBodySchema = z.object({
  id: z.string().min(1),
  messageId: z.string().min(1),
  identifier: z.string().min(1),
  type: z.string().min(1),
  title: z.string(),
  content: z.string(),
});

export function registerArtifactRoutes(router: HttpRouter): void {
  router.add('GET', '/api/artifacts/:conversationId', async (req, res, { params }) => {
    const { conversationId } = params;
    const artifacts = await listArtifacts(conversationId);
    return sendJson(res, 200, { artifacts });
  });

  router.add('POST', '/api/artifacts/:conversationId', async (req, res, { params }) => {
    const { conversationId } = params;
    const body = await readJsonBody(req, UpsertArtifactBodySchema);
    const artifact = await upsertArtifact(conversationId, body);
    return sendJson(res, 200, { artifact });
  });

  router.add('DELETE', '/api/artifacts/:conversationId/:artifactId', async (req, res, { params }) => {
    const { conversationId, artifactId } = params;
    if (!artifactId) throw new BadRequestError('Missing artifactId');
    await deleteArtifact(conversationId, artifactId);
    return sendJson(res, 200, { ok: true });
  });
}
