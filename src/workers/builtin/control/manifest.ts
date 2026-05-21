import type { WorkerManifest } from '../../types';
import {
  disableJob,
  disableWorker,
  enableJob,
  enableWorker,
  listJobs,
  listWorkerStatus,
  setJobSchedule,
  triggerJob,
} from './tools';

export const controlWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.control',
  name: 'Control',
  displayName: 'Conversational Control Panel',
  version: '0.1.0',
  description: 'Assistant tools that map natural-language commands to BFrost dashboard actions.',
  tagline:
    'Tell the assistant to enable the news digest at 8 am, run the research job now, or disable a worker — and it just works.',
  builtIn: true,
  jobs: [],
  tools: [
    // -----------------------------------------------------------------------
    // Job tools
    // -----------------------------------------------------------------------
    {
      id: 'list-jobs',
      workerId: 'core.control',
      name: 'listJobs',
      description:
        'List all registered scheduler jobs with their current status (enabled/disabled, schedule, running, last run time). Use this when the user asks what jobs exist, which jobs are active, or what is scheduled.',
      permissions: ['storage:read'],
      defaultEnabled: true,
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        return listJobs();
      },
    },
    {
      id: 'enable-job',
      workerId: 'core.control',
      name: 'enableJob',
      description:
        'Enable a scheduler job so it runs on its cron schedule again. Use when the user says "enable the news digest", "turn on the research job", or similar.',
      permissions: ['scheduler:write'],
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          jobName: {
            type: 'string',
            description: 'The job id (e.g. "news-digest") or a recognisable part of its label (e.g. "news").',
          },
        },
        required: ['jobName'],
      },
      async execute(input: Record<string, unknown>) {
        return enableJob(input as { jobName: string });
      },
    },
    {
      id: 'disable-job',
      workerId: 'core.control',
      name: 'disableJob',
      description:
        'Disable a scheduler job so it stops running on its cron schedule. Use when the user says "disable the news digest", "pause the research job", or similar.',
      permissions: ['scheduler:write'],
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          jobName: {
            type: 'string',
            description: 'The job id or a recognisable part of its label.',
          },
        },
        required: ['jobName'],
      },
      async execute(input: Record<string, unknown>) {
        return disableJob(input as { jobName: string });
      },
    },
    {
      id: 'set-job-schedule',
      workerId: 'core.control',
      name: 'setJobSchedule',
      description:
        'Change the cron schedule for a job and re-enable it. Use when the user says "run the news digest at 8am", "schedule the research job for every Monday at 9", or gives any time/frequency instruction for a job. The cron expression must follow the standard 5-field cron syntax (minute hour day-of-month month day-of-week).',
      permissions: ['scheduler:write'],
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          jobName: {
            type: 'string',
            description: 'The job id or a recognisable part of its label.',
          },
          cron: {
            type: 'string',
            description:
              'Standard 5-field cron expression, e.g. "0 8 * * *" for 8:00 AM daily, "0 9 * * 1" for Monday 9 AM.',
          },
        },
        required: ['jobName', 'cron'],
      },
      async execute(input: Record<string, unknown>) {
        return setJobSchedule(input as { jobName: string; cron: string });
      },
    },
    {
      id: 'trigger-job',
      workerId: 'core.control',
      name: 'triggerJob',
      description:
        'Trigger a job to run immediately, without waiting for its next scheduled time. Use when the user says "run the research job now", "kick off the news digest", or "fetch news right now".',
      permissions: ['scheduler:write'],
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          jobName: {
            type: 'string',
            description: 'The job id or a recognisable part of its label.',
          },
        },
        required: ['jobName'],
      },
      async execute(input: Record<string, unknown>) {
        return triggerJob(input as { jobName: string });
      },
    },

    // -----------------------------------------------------------------------
    // Worker tools
    // -----------------------------------------------------------------------
    {
      id: 'list-workers',
      workerId: 'core.control',
      name: 'listWorkers',
      description:
        'List all registered workers and whether they are currently enabled or disabled. Use this when the user asks what workers are installed, which integrations are active, or what capabilities BFrost has.',
      permissions: ['storage:read'],
      defaultEnabled: true,
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        return listWorkerStatus();
      },
    },
    {
      id: 'enable-worker',
      workerId: 'core.control',
      name: 'enableWorker',
      description:
        'Enable a worker so its jobs, tools, and channel adapters become active. Use when the user says "enable the Twitter publisher", "turn on the Telegram channel", or similar.',
      permissions: ['workers:write'],
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          workerId: {
            type: 'string',
            description:
              'The worker id (e.g. "core.publisher.x") or a recognisable part of its display name (e.g. "twitter", "telegram").',
          },
        },
        required: ['workerId'],
      },
      async execute(input: Record<string, unknown>) {
        return enableWorker(input as { workerId: string });
      },
    },
    {
      id: 'disable-worker',
      workerId: 'core.control',
      name: 'disableWorker',
      description:
        'Disable a worker so it no longer runs jobs, exposes tools, or processes channel messages. Use when the user says "disable the Telegram bot", "disconnect WhatsApp", or "turn off the news worker".',
      permissions: ['workers:write'],
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          workerId: {
            type: 'string',
            description:
              'The worker id or a recognisable part of its display name.',
          },
        },
        required: ['workerId'],
      },
      async execute(input: Record<string, unknown>) {
        return disableWorker(input as { workerId: string });
      },
    },
  ],
};
