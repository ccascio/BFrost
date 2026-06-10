import type { WorkerManifest } from '../../types';

// All worker IDs referenced here are data, not core code — the recipe mechanism is generic.
// Adding or removing a recipe is a manifest edit, not a core change.
export const catalogManifest: WorkerManifest = {
  id: 'core.catalog',
  name: 'Catalog',
  displayName: 'Recipe Catalog',
  version: '1.0.0',
  description: 'Declares the built-in one-click outcome recipes shown on the overview.',
  tagline: 'One-click setup for the most common AI workflows.',
  builtIn: true,
  section: 'system',
  jobs: [],
  recipes: [
    {
      id: 'watch-topic-research-notes',
      label: 'Watch a topic, write research notes',
      description: 'Pick a topic and get a Markdown research note written to your local files on a schedule.',
      steps: [
        { workerId: 'core.news' },
        { workerId: 'core.research' },
      ],
      requiredInputs: [
        {
          key: 'topic',
          label: 'Topic to research',
          helpText: 'e.g. "generative AI" or "renewable energy"',
          storage: {
            type: 'global-kv-array',
            kvKey: 'research.settings',
            arrayField: 'topics',
          },
        },
      ],
    },
    {
      id: 'morning-digest-telegram',
      label: 'Morning digest on Telegram',
      description: 'Get a curated news and research digest delivered to your Telegram every morning.',
      steps: [
        { workerId: 'core.news' },
        { workerId: 'core.research' },
        { workerId: 'core.channels.telegram' },
      ],
      requiredInputs: [
        {
          key: 'topic',
          label: 'Research topic',
          helpText: 'e.g. "AI tools" or "climate policy"',
          storage: {
            type: 'global-kv-array',
            kvKey: 'research.settings',
            arrayField: 'topics',
          },
        },
        {
          key: 'botToken',
          label: 'Telegram Bot Token',
          helpText: 'Create a bot with @BotFather on Telegram to get your token.',
          inputType: 'password',
          storage: {
            type: 'worker-kv',
            workerId: 'core.channels.telegram',
            kvKey: 'credentials',
            kvField: 'botToken',
          },
        },
      ],
      platformSettings: {
        primaryChannelId: 'core.channels.telegram',
      },
    },
    {
      id: 'publish-to-x',
      label: 'Publish to X from a feed',
      description: 'Curate news articles and auto-publish your takes to X (Twitter) on a schedule.',
      steps: [
        { workerId: 'core.news' },
        { workerId: 'core.publisher.x' },
      ],
      requiredInputs: [
        {
          key: 'xConsumerKey',
          label: 'X API Key',
          inputType: 'password',
          storage: {
            type: 'worker-kv',
            workerId: 'core.publisher.x',
            kvKey: 'credentials',
            kvField: 'xConsumerKey',
          },
        },
        {
          key: 'xConsumerSecret',
          label: 'X API Secret',
          inputType: 'password',
          storage: {
            type: 'worker-kv',
            workerId: 'core.publisher.x',
            kvKey: 'credentials',
            kvField: 'xConsumerSecret',
          },
        },
        {
          key: 'xAccessToken',
          label: 'X Access Token',
          inputType: 'password',
          storage: {
            type: 'worker-kv',
            workerId: 'core.publisher.x',
            kvKey: 'credentials',
            kvField: 'xAccessToken',
          },
        },
        {
          key: 'xAccessTokenSecret',
          label: 'X Access Token Secret',
          inputType: 'password',
          storage: {
            type: 'worker-kv',
            workerId: 'core.publisher.x',
            kvKey: 'credentials',
            kvField: 'xAccessTokenSecret',
          },
        },
      ],
    },
  ],
};
