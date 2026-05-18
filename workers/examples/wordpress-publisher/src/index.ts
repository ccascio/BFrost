import { z } from 'zod';
import type { BackendWorkerModule, WorkerManifest } from 'bfrost';
import { runWordPressPublisher } from './job.js';
import { wordpressRoutes } from './routes.js';
import { CONSUMER_ID } from './settings.js';

const WP_JOB_ID = 'wordpress-publish';
const paramsSchema = z.object({}).passthrough();
const DEFAULT_WP_PROMPT =
  'You are a careful content writer. Customise this prompt to set tone, voice, length, and structure. Returns publication-ready HTML.';

const manifest: WorkerManifest = {
  id: CONSUMER_ID,
  name: 'WordPress Publisher',
  version: '0.1.0',
  description: 'Consumes news.article items and publishes them to a self-hosted WordPress site via the REST API.',
  builtIn: false,
  ownedSettings: [
    {
      key: 'wordpress-publisher-config',
      label: 'WordPress site',
      description: 'Base URL, username, application password, default status, categories, tags, and prompt.',
      scope: 'worker',
      storageKey: 'worker.local.publisher.wordpress.settings',
      dashboardTarget: 'config',
    },
    {
      key: 'wordpress-publisher-job',
      label: 'WordPress publish schedule',
      description: 'Cron, model, and parameter settings for the publish job.',
      scope: 'job',
      storageKey: `admin.settings.jobs.${WP_JOB_ID}`,
      dashboardTarget: 'jobs',
    },
  ],
  jobs: [
    {
      id: WP_JOB_ID,
      workerId: CONSUMER_ID,
      label: 'WordPress publish',
      description: 'Picks an eligible news.article item and publishes it to the configured WordPress site.',
      defaultEnabled: false,
      defaultCron: '0 */6 * * *',
      defaultModelAlias: '',
      approvalRequiredDefault: true,
      approvalRequiredEditable: true,
      defaultPrompt: DEFAULT_WP_PROMPT,
      prompt: {
        editable: false,
        helpText: 'Edit the prompt in the Config tab — that field is the source of truth.',
      },
      paramsSchema,
      defaultParams: {},
      dashboardFields: [],
      run: async () => {
        const result = await runWordPressPublisher();
        return { summary: result.summary, itemCount: result.status === 'ok' ? 1 : 0 };
      },
    },
  ],
  dashboard: {
    settings: [
      {
        id: 'wordpress-publisher-config',
        label: 'WordPress connection',
        description:
          'Application Password authentication. Generate one at Users → Profile → Application Passwords on your WP site. ' +
          'Saving the form fetches categories and tags from your site and caches them for the publish job.',
        tab: 'config',
        path: '/api/workers/local.publisher.wordpress/settings',
        fields: [
          {
            key: 'baseUrl',
            label: 'WordPress base URL',
            type: 'text',
            defaultValue: '',
            placeholder: 'https://my-site.example.com',
            helpText: 'No trailing slash, no /wp-json — just the site root.',
            seedPath: 'local.publisher.wordpress.settings.baseUrl',
          },
          {
            key: 'username',
            label: 'WordPress username',
            type: 'text',
            defaultValue: '',
            seedPath: 'local.publisher.wordpress.settings.username',
          },
          {
            key: 'applicationPassword',
            label: 'Application Password',
            type: 'secret-reference',
            defaultValue: '',
            placeholder: 'xxxx xxxx xxxx xxxx xxxx xxxx',
            helpText:
              'WordPress generates Application Passwords with spaces — paste as-is. Falls back to WORDPRESS_APPLICATION_PASSWORD env var if blank.',
            seedPath: 'local.publisher.wordpress.settings.applicationPassword',
          },
          {
            key: 'defaultStatus',
            label: 'Publish as',
            type: 'select',
            defaultValue: 'draft',
            options: [
              { value: 'draft', label: 'Draft (recommended while testing)' },
              { value: 'pending', label: 'Pending review' },
              { value: 'publish', label: 'Publish immediately' },
              { value: 'private', label: 'Private' },
            ],
            seedPath: 'local.publisher.wordpress.settings.defaultStatus',
          },
          {
            key: 'categorySlugs',
            label: 'Category slugs',
            type: 'string-list',
            defaultValue: [],
            rows: 3,
            helpText:
              'One slug per line (e.g. "ai", "privacy"). Resolved to IDs from the cached taxonomy fetched on Save.',
            seedPath: 'local.publisher.wordpress.settings.categorySlugs',
          },
          {
            key: 'tagSlugs',
            label: 'Tag slugs',
            type: 'string-list',
            defaultValue: [],
            rows: 3,
            seedPath: 'local.publisher.wordpress.settings.tagSlugs',
          },
          {
            key: 'modelAlias',
            label: 'Model alias',
            type: 'text',
            defaultValue: '',
            helpText: 'Leave blank to use the default model. Otherwise enter an alias from the Models tab.',
            seedPath: 'local.publisher.wordpress.settings.modelAlias',
          },
          {
            key: 'prompt',
            label: 'Article style prompt',
            type: 'textarea',
            defaultValue: '',
            rows: 10,
            helpText:
              'Customise tone, voice, length, and structure. Leave blank to use the built-in default ' +
              '(direct, calm, 400–700 words, plain HTML). The prompt receives the source title, description, ' +
              'URL, and excerpt as user-message context.',
            seedPath: 'local.publisher.wordpress.settings.prompt',
          },
        ],
      },
    ],
  },
};

const module: BackendWorkerModule = {
  manifest,
  apiRoutes: wordpressRoutes,
  lifecycle: {
    async onEnable() {
      // Best-effort taxonomy refresh on enable. Don't block the enable — the user may
      // not have filled in credentials yet.
      try {
        const { refreshTaxonomies } = await import('./job.js');
        await refreshTaxonomies();
      } catch {
        // ignored — settings probably incomplete
      }
    },
  },
};

export default module;
