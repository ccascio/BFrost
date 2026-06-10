import { openWorkerKv } from '../../storage';
import { buildItemDraft, publishItem, setConsumerMetadata } from '../../../jobs/item-bus';
import { createQueueItem, loadQueue, saveQueue, withQueueLock } from '../../../jobs/queue';
import type { WorkerJobRunResult } from '../../types';

const WORKER_ID = 'core.demo';
const LAST_RUN_KEY = 'demo.lastRun';

interface DemoArticle {
  title: string;
  shortDesc: string;
  url: string;
  source: string;
}

export interface DemoStage {
  label: string;
  detail: string;
}

export interface DemoRecap {
  headline: string;
  body: string;
  ctaText?: string;
  ctaAction?: string;
}

export interface DemoRunResult extends WorkerJobRunResult {
  stages: DemoStage[];
  recap: DemoRecap;
}

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

export async function runDemo(): Promise<DemoRunResult> {
  await withQueueLock(async () => {
    const queue = await loadQueue();
    const filtered = queue.filter((item) => item.producerWorkerId !== WORKER_ID);
    if (filtered.length !== queue.length) await saveQueue(filtered);
  });

  const ranAt = new Date().toISOString();

  // Stage 1: publish news articles to the bus
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

  // Stage 2: simulate a research consumer picking up 3 articles and producing a note.
  // This stamps real consumer metadata into the bus so the Pipeline view can show
  // the producer → Item Bus → consumer topology from generic metadata keys alone.
  await withQueueLock(async () => {
    const queue = await loadQueue();
    const articles = queue.filter(
      (item) => item.producerWorkerId === WORKER_ID && item.itemType === 'news.article',
    );
    // Mark three of the four articles as consumed by a research worker.
    for (const item of articles.slice(0, 3)) {
      setConsumerMetadata(item, 'core.research', { consumedAt: ranAt, synthesized: true });
    }
    // Publish the research note as a new item from the same demo producer.
    const noteDraft = buildItemDraft({
      producerWorkerId: WORKER_ID,
      itemType: 'research.note',
      tags: ['demo'],
      title: 'Research synthesis: The self-hosted operator stack',
      shortDesc: "Control is moving back to the operator — self-hosted schedulers, local LLMs, and approval-gated agents all point the same way.",
      url: 'https://example.com/demo/research-note',
      selectionReason: 'Synthesized by the demo pipeline from 3 sample news articles.',
      payload: { demo: true, sourceArticleCount: 3 },
      addedAt: ranAt,
    });
    queue.push(createQueueItem(noteDraft));
    await saveQueue(queue);
  });

  const snapshot: DemoRunSnapshot = { ranAt, articles: DEMO_ARTICLES, researchNote: DEMO_RESEARCH_NOTE };
  await openWorkerKv(WORKER_ID).set(LAST_RUN_KEY, snapshot);

  return {
    summary:
      `Demo pipeline ran with no setup: published ${DEMO_ARTICLES.length} sample news articles, ` +
      'the research worker consumed 3 of them and produced a research note — all with no API key or model.',
    itemCount: DEMO_ARTICLES.length + 1,
    stages: [
      {
        label: `Step 1 of 3 — News published`,
        detail: `${DEMO_ARTICLES.length} sample articles landed in the Item Bus as news.article items.`,
      },
      {
        label: 'Step 2 of 3 — Research consumed',
        detail: '3 articles were picked up by the research worker and synthesized into a note.',
      },
      {
        label: 'Step 3 of 3 — Pipeline complete',
        detail: `5 items in the bus: 4 news articles (3 consumed) + 1 research.note. Open Pipeline to see the graph.`,
      },
    ],
    recap: {
      headline: 'The pipeline just ran',
      body:
        'News articles arrived as producer items. The research worker consumed three of them and published a synthesis note. ' +
        "That's the producer → Item Bus → consumer contract — no API key, no model, just workers talking through the bus.",
      ctaText: 'Plug in a real model →',
      ctaAction: 'wizard',
    },
  };
}

export async function loadDemoSnapshot(): Promise<DemoRunSnapshot | null> {
  return openWorkerKv(WORKER_ID).get<DemoRunSnapshot>(LAST_RUN_KEY);
}
