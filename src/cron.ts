import { findModel, getDefaultModelAlias, availableModels } from './config';
import { isJobName, knownJobs, runFreeformTask, runNamedJob } from './job-runner';
import { refreshActiveLocalProviderModels } from './model-discovery';
import { notifyOperatorChannels } from './workers/registry';

interface CliArgs {
  modelAlias: string;
  job: string | null;
  task: string;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  let modelAlias = getDefaultModelAlias();
  let job: string | null = null;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--model' || a === '-m') && i + 1 < argv.length) {
      modelAlias = argv[++i];
    } else if ((a === '--job' || a === '-j') && i + 1 < argv.length) {
      job = argv[++i];
    } else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else {
      rest.push(a);
    }
  }

  const task = rest.join(' ').trim();
  if (job && task) {
    console.error('[Cron] Specify either --job <name> or a free-form task, not both.');
    process.exit(2);
  }
  if (!job && !task) {
    printUsage();
    process.exit(2);
  }
  if (job && !isJobName(job)) {
    console.error(`[Cron] Unknown job: ${job}. Known jobs: ${knownJobs().join(', ')}`);
    process.exit(2);
  }
  return { modelAlias, job, task };
}

function printUsage(): void {
  const aliases = availableModels.map((m) => `${m.alias} (${m.label})`).join('\n  ');
  const jobs = knownJobs().join(', ') || '(none)';
  console.error(
    `Usage:\n` +
    `  node dist/cron.js [--model <alias>] --job <name>\n` +
    `  node dist/cron.js [--model <alias>] "<free-form task>"\n` +
    `  npm run task -- [--model <alias>] --job <name>   (note the "--" separator)\n\n` +
    `Available models:\n  ${aliases}\n\n` +
    `Available jobs:\n  ${jobs}\n\n` +
    `Examples:\n` +
    `  node dist/cron.js --job <job-id>\n` +
    `  node dist/cron.js "Summarize today's top AI news in 3 bullets."`,
  );
}

async function main(): Promise<void> {
  await refreshActiveLocalProviderModels();
  const { modelAlias, job, task } = parseArgs();
  const model = findModel(modelAlias);
  if (!model) {
    console.error(`[Cron] Unknown model alias: ${modelAlias}`);
    process.exit(2);
  }

  console.log(`[Cron] ${job ? `Job: ${job}` : `Task: ${task}`}`);
  console.log(`[Cron] Model: ${model.label}`);

  let outcome: string;
  try {
    if (job) {
      const result = await runNamedJob(job, modelAlias);
      outcome = result.summary;
    } else {
      const result = await runFreeformTask(task, modelAlias);
      outcome = result.summary;
    }
    console.log('[Cron] Outcome:\n' + outcome);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isLockSkip = msg.includes('Could not acquire queue lock');
    if (isLockSkip) {
      console.warn(`[Cron] ${msg}`);
    } else {
      console.error('[Cron] Run failed:', err);
      try {
        await notifyOperatorChannels(`Cron ${job ?? 'task'} fallito: ${msg}`);
      } catch (notifyErr) {
        console.error('[Cron] Also failed to notify operator channels:', notifyErr);
      }
    }
    process.exit(isLockSkip ? 0 : 1);
  }

  try {
    await notifyOperatorChannels(outcome);
  } catch (err) {
    console.error('[Cron] Failed to deliver operator notification:', err);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Cron] Fatal error:', err);
    process.exit(1);
  });
