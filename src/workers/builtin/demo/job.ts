import { openWorkerKv } from '../../storage';
import { publishItem } from '../../../jobs/item-bus';
import { loadQueue, saveQueue, withQueueLock } from '../../../jobs/queue';
import type { WorkerJobRunResult } from '../../types';

/**
 * The demo "run" is invoked from the worker's own onboarding API route (not the scheduler),
 * so it never touches the model-failover runner and works with zero providers configured.
 * One call publishes a handful of realistic sample articles to the Item Bus and synthesizes
 * a research note, with no API key, model, or network call involved — the fastest path from
 * `git clone` to "oh, it actually does something".
 */
const WORKER_ID = 'core.demo';
const LAST_RUN_KEY = 'demo.lastRun';

interface DemoArticle {
  title: string;
  shortDesc: string;
  url: string;
  source: string;
}

// Pre-written, plausible sample items. These are obviously fictional on close reading but
// realistic enough to show what a real news digest would queue. `host` values are example
// domains so nobody mistakes them for live sources.
const DEMO_ARTICLES: DemoArticle[] = [
  {
    title: 'Open-source schedulers gain ground as teams move automations off the cloud',
    shortDesc:
      'A wave of self-hosted orchestration tools is letting small teams run scheduled AI workflows on their own hardware, trading managed convenience for control and lower recurring cost.',
    url: 'https://example.com/demo/self-hosted-schedulers',
    source: 'example-tech.test',
  },
  {
    title: 'Local LLM runtimes close the quality gap for everyday tasks',
    shortDesc:
      'Benchmarks on summarisation and extraction show locally-run models now handle routine work well enough that many pipelines no longer need a cloud API for the common case.',
    url: 'https://example.com/demo/local-llm-runtimes',
    source: 'example-ml.test',
  },
  {
    title: 'Plugin architectures make personal automation tools easier to extend',
    shortDesc:
      'Designs where every capability is a removable plugin are spreading beyond editors into personal automation, letting users add a feature by dropping in a folder rather than forking the core.',
    url: 'https://example.com/demo/plugin-architectures',
    source: 'example-dev.test',
  },
  {
    title: 'Approval-gated agents balance autonomy with operator control',
    shortDesc:
      'Rather than running unattended, a new class of agents queues risky actions for human approval with a diff preview — keeping a person in the loop without slowing routine work.',
    url: 'https://example.com/demo/approval-gated-agents',
    source: 'example-ops.test',
  },
];

// Canned synthesis of the articles above — the "research" stage of the pipeline, produced
// without calling a model so the demo is fully self-contained.
const DEMO_RESEARCH_NOTE = [
  '# Sample research note',
  '',
  "Today's sample items share one throughline: **control is moving back to the operator.**",
  '',
  '- Self-hosted schedulers and local LLM runtimes remove the dependency on managed cloud services for routine work.',
  '- Plugin/worker architectures make that self-hosted core extensible without forks.',
  '- Approval-gated agents keep a human in the loop so autonomy never means losing oversight.',
  '',
  'Taken together they describe exactly the niche BFrost targets: a local, worker-first',
  'automation substrate you fully own. This note was generated with no API key and no model —',
  'connect a provider to produce notes like this from real, live news.',
].join('\n');

export interface DemoRunSnapshot {
  ranAt: string;
  articles: DemoArticle[];
  researchNote: string;
}

/**
 * Run the zero-config demo pipeline. Self-contained: depends on no other worker, no model,
 * and no network. Clears any previous demo items first so repeated clicks show a fresh,
 * clean flow rather than piling up duplicates.
 */
export async function runDemo(): Promise<WorkerJobRunResult> {
  // Remove items from a previous demo run so re-running stays tidy. We only ever touch
  // items this worker produced.
  await withQueueLock(async () => {
    const queue = await loadQueue();
    const filtered = queue.filter((item) => item.producerWorkerId !== WORKER_ID);
    if (filtered.length !== queue.length) {
      await saveQueue(filtered);
    }
  });

  const ranAt = new Date().toISOString();
  for (const article of DEMO_ARTICLES) {
    await publishItem({
      producerWorkerId: WORKER_ID,
      itemType: 'news.article',
      tags: ['demo'],
      title: article.title,
      shortDesc: article.shortDesc,
      url: article.url,
      selectionReason: 'Sample item produced by the zero-config demo — no model or credentials used.',
      payload: { source: { host: article.source }, demo: true },
    });
  }

  const snapshot: DemoRunSnapshot = { ranAt, articles: DEMO_ARTICLES, researchNote: DEMO_RESEARCH_NOTE };
  await openWorkerKv(WORKER_ID).set(LAST_RUN_KEY, snapshot);

  return {
    summary:
      `Demo pipeline ran with no setup: published ${DEMO_ARTICLES.length} sample articles to the Item Bus ` +
      'and synthesized a research note — no API key or model needed. Open the Queue to see the items flow.',
    itemCount: DEMO_ARTICLES.length,
  };
}

/** Read the last demo run snapshot for the dashboard surface. */
export async function loadDemoSnapshot(): Promise<DemoRunSnapshot | null> {
  return openWorkerKv(WORKER_ID).get<DemoRunSnapshot>(LAST_RUN_KEY);
}
