import { tool } from 'ai';
import { listWorkerJobs } from './registry';

/**
 * Generate one synthetic AI SDK tool per registered worker job, so the assistant
 * can trigger jobs (news-digest, tweet-post, ...) on demand from any channel.
 *
 * Execution is fire-and-forget: the tool returns immediately, and the job's
 * outcome is delivered via the existing operator-channel notification path
 * (see scheduler.runJobWork's notifyOnCompletion branch).
 *
 * The scheduler import is dynamic because scheduler → job-runner → agent
 * already forms an import chain; pulling scheduler in eagerly here would
 * close the loop into a CJS circular import.
 */
export function buildJobToolCatalog(): Record<string, any> {
  const catalog: Record<string, any> = {};
  for (const job of listWorkerJobs()) {
    const toolName = `runJob_${sanitizeName(job.id)}`;
    catalog[toolName] = tool({
      description:
        `Trigger the "${job.label}" job (id: ${job.id}). ${job.description} ` +
        `Runs asynchronously; the outcome will be delivered to the operator channel when complete.`,
      inputSchema: job.paramsSchema as any,
      execute: async (params: any) => {
        try {
          const { triggerJobNow } = await import('../scheduler');
          await triggerJobNow(job.id, {
            paramsOverride: params,
            notifyOnCompletion: true,
          });
          return `Started "${job.label}". You'll receive the outcome when it completes.`;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Could not start "${job.label}": ${msg}`;
        }
      },
    });
  }
  return catalog;
}

function sanitizeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}
