/**
 * Enforce "at most one instance of this project's server" across daemon
 * start/stop and installed OS services.
 *
 * A port-only check (`lsof -ti :PORT`) misses processes that are still
 * starting up, hung before they bind, or were launched by hand (e.g.
 * `node dist/index.js` from a stray terminal) — those never show up on the
 * port but keep burning CPU. We instead match by the project's absolute
 * entry-point path, which is unique per project root, so it can never catch
 * a sibling project's process even if several forks run side by side.
 */
import { execFileSync } from 'node:child_process';

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** All PIDs (as strings) currently running this project's server, by any means. */
export function findServerPids({ ENTRY, RUNNER, PORT }) {
  const pids = new Set();

  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
      out
        .split('\n')
        .filter((l) => l.includes(`:${PORT} `) && l.includes('LISTENING'))
        .forEach((l) => pids.add(l.trim().split(/\s+/).at(-1)));
    } else {
      execFileSync('lsof', ['-ti', `:${PORT}`], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean)
        .forEach((pid) => pids.add(pid));
    }
  } catch { /* nothing bound to the port */ }

  try {
    if (process.platform === 'win32') {
      for (const target of [ENTRY, RUNNER]) {
        const escaped = target.replace(/\\/g, '\\\\');
        try {
          const out = execFileSync(
            'wmic',
            ['process', 'where', `CommandLine like '%${escaped}%'`, 'get', 'ProcessId'],
            { encoding: 'utf8' },
          );
          out
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => /^\d+$/.test(l))
            .forEach((pid) => pids.add(pid));
        } catch { /* wmic not available or no match */ }
      }
    } else {
      for (const target of [ENTRY, RUNNER]) {
        try {
          execFileSync('pgrep', ['-f', target], { encoding: 'utf8' })
            .trim()
            .split('\n')
            .filter(Boolean)
            .forEach((pid) => pids.add(pid));
        } catch { /* no match */ }
      }
    }
  } catch { /* best effort */ }

  pids.delete(String(process.pid));
  return [...pids];
}

/** SIGTERM every PID, waiting (without busy-spinning the CPU) then SIGKILL survivors. */
export function killPids(pids, { graceMs = 3000 } = {}) {
  if (!pids.length) return;

  if (process.platform === 'win32') {
    for (const pid of pids) {
      try { execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
    }
    return;
  }

  try { execFileSync('kill', pids, { stdio: 'ignore' }); } catch { /* already gone */ }

  const isAlive = (pid) => {
    try { execFileSync('kill', ['-0', pid], { stdio: 'ignore' }); return true; }
    catch { return false; }
  };

  let remaining = pids;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    remaining = remaining.filter(isAlive);
    if (!remaining.length) return;
    sleepSync(100);
  }

  remaining = remaining.filter(isAlive);
  if (remaining.length) {
    try { execFileSync('kill', ['-9', ...remaining], { stdio: 'ignore' }); } catch { /* already gone */ }
  }
}

/** Find and kill every running instance of this project's server. Returns the PIDs it stopped. */
export function stopAllServerInstances(service, opts) {
  const pids = findServerPids(service);
  if (pids.length) killPids(pids, opts);
  return pids;
}
