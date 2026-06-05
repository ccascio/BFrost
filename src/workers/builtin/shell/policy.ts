/**
 * Security policy for the shell-exec worker.
 *
 * The policy is the access-control surface: an allowlist of bare command names plus
 * resource caps. It is fail-closed — an empty allowlist means *no* command can run,
 * so enabling the worker grants nothing until an operator lists commands in
 * Config → Shell commands.
 *
 * Persisted through the worker's own KV namespace (`worker.core.shell.config`) so it is
 * carried by app backups and isolated from every other worker.
 */
import { z } from 'zod';
import { openWorkerKv } from '../../storage';

export const WORKER_ID = 'core.shell';
const CONFIG_KEY = 'config';

/** Hard upper bounds the operator cannot exceed, regardless of what they configure. */
export const TIMEOUT_CAP_SECONDS = 120;
export const OUTPUT_CAP_KB = 1024;

export interface ShellPolicy {
  /** Bare binary names the assistant is allowed to invoke. Empty = nothing allowed. */
  allowedCommands: string[];
  /** Wall-clock limit per command before it is SIGKILLed. */
  timeoutSeconds: number;
  /** Cap on captured stdout/stderr; output beyond this is truncated. */
  maxOutputKb: number;
  /** Sandbox root the command runs in; an optional per-call cwd cannot escape it. */
  workingDir: string;
}

export const DEFAULT_POLICY: ShellPolicy = {
  allowedCommands: [],
  timeoutSeconds: 10,
  maxOutputKb: 64,
  workingDir: './data/shell-sandbox',
};

/** A bare binary name — no path separators, so an allowlist entry cannot smuggle a path. */
const CommandName = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'Command names must be bare binary names (no path separators).',
  );

export const ShellPolicySchema = z.object({
  allowedCommands: z.array(CommandName).default(DEFAULT_POLICY.allowedCommands),
  timeoutSeconds: z
    .number()
    .int()
    .positive()
    .max(TIMEOUT_CAP_SECONDS)
    .default(DEFAULT_POLICY.timeoutSeconds),
  maxOutputKb: z
    .number()
    .int()
    .positive()
    .max(OUTPUT_CAP_KB)
    .default(DEFAULT_POLICY.maxOutputKb),
  workingDir: z.string().trim().min(1).default(DEFAULT_POLICY.workingDir),
});

function normalize(policy: z.infer<typeof ShellPolicySchema>): ShellPolicy {
  return {
    allowedCommands: [...new Set(policy.allowedCommands)],
    timeoutSeconds: policy.timeoutSeconds,
    maxOutputKb: policy.maxOutputKb,
    workingDir: policy.workingDir,
  };
}

/** Load the operator's policy, falling back to the fail-closed default on any problem. */
export async function loadPolicy(): Promise<ShellPolicy> {
  const stored = await openWorkerKv(WORKER_ID).get<unknown>(CONFIG_KEY);
  const parsed = ShellPolicySchema.safeParse(stored ?? {});
  if (!parsed.success) return { ...DEFAULT_POLICY };
  return normalize(parsed.data);
}

/** Validate and persist a policy submitted from the Config form. */
export async function savePolicy(input: unknown): Promise<ShellPolicy> {
  const policy = normalize(ShellPolicySchema.parse(input));
  await openWorkerKv(WORKER_ID).set(CONFIG_KEY, policy);
  return policy;
}
