import { execFileSync } from 'node:child_process';

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function findServerPids({ ENTRY, RUNNER, PORT }) {
  const pids = new Set();
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
      out.split('\n').filter((line) => line.includes(`:${PORT} `) && line.includes('LISTENING'))
        .forEach((line) => pids.add(line.trim().split(/\s+/).at(-1)));
    } else {
      execFileSync('lsof', ['-ti', `:${PORT}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
        .forEach((pid) => pids.add(pid));
    }
  } catch { /* nothing bound */ }
  if (process.platform !== 'win32') {
    for (const target of [ENTRY, RUNNER]) {
      try {
        execFileSync('pgrep', ['-f', target], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
          .forEach((pid) => pids.add(pid));
      } catch { /* no matching process */ }
    }
  }
  pids.delete(String(process.pid));
  return [...pids].filter(Boolean);
}

export function killPids(pids, { graceMs = 3000 } = {}) {
  if (!pids.length) return;
  if (process.platform === 'win32') {
    for (const pid of pids) try { execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
    return;
  }
  try { execFileSync('kill', pids, { stdio: 'ignore' }); } catch { /* gone */ }
  const alive = (pid) => { try { execFileSync('kill', ['-0', pid], { stdio: 'ignore' }); return true; } catch { return false; } };
  let remaining = pids;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    remaining = remaining.filter(alive);
    if (!remaining.length) return;
    sleepSync(100);
  }
  remaining = remaining.filter(alive);
  if (remaining.length) try { execFileSync('kill', ['-9', ...remaining], { stdio: 'ignore' }); } catch { /* gone */ }
}

export function stopAllServerInstances(service, options) {
  const pids = findServerPids(service);
  killPids(pids, options);
  return pids;
}
