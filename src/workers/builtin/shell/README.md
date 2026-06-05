# Shell Commands worker (`core.shell`)

Gives the assistant a tightly-scoped `shellExec` tool that runs **allowlisted** CLI
commands inside a sandboxed working directory and returns their stdout, stderr, and exit
code.

## What it does

- Registers one assistant tool, `shellExec`, that takes a bare `command`, an `args` array,
  and an optional `cwd`.
- Runs the command with `execFile` — **no shell is ever spawned**, so pipes, redirects,
  globbing, command substitution, and chaining are not interpreted. Arguments are passed
  literally.

## Access controls

The policy is the security surface, configured in **Config → Shell commands** and stored
under the worker's own KV namespace (`worker.core.shell.config`):

| Setting | Default | Effect |
| --- | --- | --- |
| Allowed commands | _empty_ | Bare binary names the assistant may run. **Empty = nothing runs.** |
| Timeout (seconds) | 10 (max 120) | Command is force-killed with SIGKILL after this long. |
| Max output (KB) | 64 (max 1024) | stdout/stderr captured beyond this is truncated. |
| Sandbox working directory | `./data/shell-sandbox` | Commands run here; a per-call `cwd` may descend into it but never escape. |

Layered gates, all off/closed by default:

1. **Worker enabled state** — disable the worker in the Workers tab and the tool disappears.
2. **Fail-closed allowlist** — the allowlist ships empty. Enabling the worker grants
   nothing until an operator lists commands.
3. **Bare-name allowlist** — entries and the requested command must be bare binary names;
   a path like `/bin/sh` is rejected, so an allowlist entry cannot smuggle a path.
4. **Scrubbed environment** — the child sees only `PATH`, `HOME`, and `LANG`. Host secrets
   (API keys, tokens) are withheld.
5. **Timeout + output cap** — runaway or noisy commands are bounded.

## What this is NOT

This is a **policy filter, not an OS-level jail.** It does not virtualise the filesystem
or drop OS privileges. An allowlisted `cat` can still read any file the host user can by
absolute path; an allowlisted interpreter (`node`, `python`, `bash`) or a tool that can
launch other programs (`find -exec`, `xargs`, `env`, `ssh`, some `git` flags) effectively
widens the boundary to "anything." **Allowlist only commands whose full capability you
trust.** Treat the assistant as potentially prompt-injected (it can ingest untrusted web
content via other workers), so the allowlist is the boundary that matters.

> Note: `permissions: ['shell:exec']` is declared for forward-compatibility with BFrost's
> upcoming permissioned-action runtime (ROADMAP W5). It is **not enforced yet** — today the
> gates above are the real controls.

## Inputs / outputs

- **Tool:** `shellExec({ command, args?, cwd? }) -> string`
- **Produces / consumes:** nothing on the Item Bus. No jobs, no channels, no providers.
- **Credentials / env vars:** none.
- **Owned settings:** `worker.core.shell.config` (the policy above).

## Example setup

1. Enable the **Shell Commands** worker in the Workers tab.
2. In Config → Shell commands, add `ls`, `cat`, and `git` to the allowlist, then Save.
3. Ask the assistant: _"List the files in the sandbox, then show git status."_

Anything not on the allowlist comes back as `Refused: …` without ever spawning a process.

## Troubleshooting

- **"Refused: empty command allowlist"** — you enabled the worker but did not add any
  commands. Populate the allowlist in Config → Shell commands.
- **"Command not found on PATH"** — the binary is not installed or not on the host `PATH`.
- **Empty output but a `top-secret` env var was expected** — by design; the child runs
  with a scrubbed environment.
