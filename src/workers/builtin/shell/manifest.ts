import type { WorkerManifest } from '../../types';
import { loadPolicy } from './policy';
import { runShellCommand, formatResult, ShellPolicyError, type ShellExecInput } from './sandbox';

export const shellWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.shell',
  name: 'Shell',
  displayName: 'Shell Commands',
  version: '0.1.0',
  description: 'Lets the assistant run allowlisted CLI commands inside a sandboxed working directory.',
  tagline:
    'Give the assistant a tightly-scoped shell: only the commands you allow, with timeouts, output caps, and a scrubbed environment. Nothing runs until you build the allowlist.',
  chatPrompts: [
    {
      label: 'List a directory',
      description: 'Run an allowlisted command in the sandbox.',
      prompt: 'List the files in the current sandbox directory.',
    },
    {
      label: 'Git status',
      description: 'Check repository state (requires git on the allowlist).',
      prompt: 'Show me git status for the sandbox checkout.',
    },
  ],
  builtIn: true,
  section: 'system',
  settingsOnly: true,
  ownedSettings: [
    {
      key: 'shell-policy',
      label: 'Shell command policy',
      description:
        'Allowlisted commands, per-command timeout, output cap, and sandbox working directory.',
      scope: 'worker',
      storageKey: 'worker.core.shell.config',
      dashboardTarget: 'config',
    },
  ],
  dashboard: {
    settings: [
      {
        id: 'shell-policy',
        label: 'Shell commands',
        description:
          'The access-control surface for the shell tool. The allowlist is empty by default — until you add commands here, every request is refused.',
        tab: 'config',
        path: '/api/shell-policy',
        fields: [
          {
            key: 'allowedCommands',
            label: 'Allowed commands',
            type: 'string-list',
            defaultValue: [],
            rows: 6,
            helpText:
              'Bare binary names only (no paths). The assistant may run only these. Note: tools like find, xargs, env, ssh and some git flags can launch other programs — allowlist them only if you trust that.',
            placeholder: 'e.g. ls',
            // Deliberately only read-only-ish commands. Interpreters (node, python, bash)
            // and program-launchers (git, find, xargs, env, ssh) are NOT suggested as
            // one-click adds because allowlisting them widens the boundary to arbitrary
            // execution — an operator who wants one must type it deliberately.
            suggestions: ['ls', 'cat', 'pwd', 'echo', 'head', 'wc'],
            seedPath: 'core.shell.policy.allowedCommands',
          },
          {
            key: 'timeoutSeconds',
            label: 'Timeout (seconds)',
            type: 'number',
            defaultValue: 10,
            min: 1,
            max: 120,
            helpText: 'Commands are force-killed (SIGKILL) after this many seconds.',
            seedPath: 'core.shell.policy.timeoutSeconds',
          },
          {
            key: 'maxOutputKb',
            label: 'Max output (KB)',
            type: 'number',
            defaultValue: 64,
            min: 1,
            max: 1024,
            helpText: 'Captured stdout/stderr is truncated beyond this size.',
            seedPath: 'core.shell.policy.maxOutputKb',
          },
          {
            key: 'workingDir',
            label: 'Sandbox working directory',
            type: 'text',
            defaultValue: './data/shell-sandbox',
            helpText:
              'Commands run here. A per-call working directory may only descend into this root, never escape it. This is a policy filter, not an OS-level jail.',
            seedPath: 'core.shell.policy.workingDir',
          },
        ],
      },
    ],
  },
  jobs: [],
  tools: [
    {
      id: 'shell-exec',
      workerId: 'core.shell',
      name: 'shellExec',
      description:
        'Run a single allowlisted CLI command inside the sandbox and return its stdout, stderr, and exit code. ' +
        'Provide the bare binary name in "command" and each argument separately in "args" — no shell syntax, pipes, ' +
        'redirects, or chaining are interpreted. Only commands the operator has allowlisted will run; anything else is refused.',
      permissions: ['shell:exec'],
      // Enabled so an enabled worker actually exposes the tool. The real gate is the
      // fail-closed allowlist (empty by default) plus the worker's enabled state.
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Bare binary name to run, e.g. "ls" or "git". No path, no arguments here.',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Arguments passed literally to the command, e.g. ["-la"] or ["status"].',
          },
          cwd: {
            type: 'string',
            description:
              'Optional working directory relative to the sandbox root. Cannot escape the sandbox.',
          },
        },
        required: ['command'],
      },
      async execute(input: ShellExecInput): Promise<string> {
        const policy = await loadPolicy();
        try {
          const result = await runShellCommand(input, policy);
          return formatResult((input.command ?? '').trim(), input.args ?? [], result);
        } catch (err) {
          if (err instanceof ShellPolicyError) return `Refused: ${err.message}`;
          throw err;
        }
      },
    },
  ],
};
