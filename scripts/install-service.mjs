/**
 * Install BFrost as an OS background service.
 *
 * macOS  → launchd LaunchAgent  (~/Library/LaunchAgents/net.bfrost.server.plist)
 * Linux  → systemd user service (~/.config/systemd/user/bfrost.service)
 * Windows→ PM2 (preferred) or Task Scheduler fallback
 *
 * The service starts automatically at login and restarts on crash.
 *
 * Usage: npm run install-service
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'dist', 'index.js');
// macOS TCC prevents launchd from opening files in ~/Documents for stdio
// redirection.  Use ~/Library/Logs which is always accessible to LaunchAgents.
const LOG_FILE = process.platform === 'darwin'
  ? path.join(homedir(), 'Library', 'Logs', 'BFrost', 'bfrost.log')
  : path.join(ROOT, 'data', 'bfrost.log');
const NODE = process.execPath;
const LABEL = 'net.bfrost.server';

function fail(msg) {
  console.error(`\nError: ${msg}`);
  process.exit(1);
}

function banner(lines) {
  console.log('\n' + lines.join('\n') + '\n');
}

if (!existsSync(ENTRY)) {
  fail('dist/index.js not found. Run: npm run build first.');
}

mkdirSync(path.join(ROOT, 'data'), { recursive: true });
mkdirSync(path.dirname(LOG_FILE), { recursive: true });

// ---------------------------------------------------------------------------
// macOS — launchd LaunchAgent
// ---------------------------------------------------------------------------
if (process.platform === 'darwin') {
  const plistDir = path.join(homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(plistDir, `${LABEL}.plist`);

  mkdirSync(plistDir, { recursive: true });

  writeFileSync(
    plistPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${ENTRY}</string>
  </array>
  <key>WorkingDirectory</key>  <string>${ROOT}</string>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key> <string>${LOG_FILE}</string>
</dict>
</plist>`,
  );

  // Unload first so a re-install doesn't leave a stale entry.
  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch { /* not previously loaded — fine */ }

  try {
    execFileSync('launchctl', ['load', plistPath], { stdio: 'inherit' });
  } catch (err) {
    fail(`launchctl load failed: ${err.message}`);
  }

  banner([
    '✓ BFrost service installed (macOS launchd).',
    `  Plist:     ${plistPath}`,
    `  Dashboard: http://127.0.0.1:3030`,
    `  Logs:      ${LOG_FILE}  →  npm run logs`,
    '',
    '  The service starts automatically at login and restarts on crash.',
    '  To remove:  npm run uninstall-service',
  ]);
}

// ---------------------------------------------------------------------------
// Linux — systemd user service
// ---------------------------------------------------------------------------
else if (process.platform === 'linux') {
  const serviceDir = path.join(homedir(), '.config', 'systemd', 'user');
  const servicePath = path.join(serviceDir, 'bfrost.service');

  mkdirSync(serviceDir, { recursive: true });

  writeFileSync(
    servicePath,
    `[Unit]
Description=BFrost local AI server
After=network.target

[Service]
ExecStart=${NODE} ${ENTRY}
WorkingDirectory=${ROOT}
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=default.target
`,
  );

  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
    execFileSync('systemctl', ['--user', 'enable', '--now', 'bfrost'], { stdio: 'inherit' });
  } catch (err) {
    fail(
      `systemctl failed: ${err.message}\n` +
      'Ensure systemd user sessions are enabled (loginctl enable-linger $USER).',
    );
  }

  banner([
    '✓ BFrost service installed (systemd user service).',
    `  Unit:      ${servicePath}`,
    `  Dashboard: http://127.0.0.1:3030`,
    `  Logs:      ${LOG_FILE}  →  npm run logs`,
    `  Status:    systemctl --user status bfrost`,
    '',
    '  The service starts automatically at login and restarts on crash.',
    '  To remove:  npm run uninstall-service',
  ]);
}

// ---------------------------------------------------------------------------
// Windows — PM2 (preferred) or Task Scheduler fallback
// ---------------------------------------------------------------------------
else if (process.platform === 'win32') {
  const hasPm2 = spawnSync('pm2', ['--version'], { shell: true }).status === 0;

  if (hasPm2) {
    // Remove any previous instance before registering.
    spawnSync('pm2', ['delete', 'bfrost'], { shell: true, stdio: 'ignore' });

    const start = spawnSync(
      'pm2',
      ['start', ENTRY, '--name', 'bfrost', '--cwd', ROOT,
        '--output', LOG_FILE, '--error', LOG_FILE],
      { shell: true, stdio: 'inherit' },
    );
    if (start.status !== 0) fail('pm2 start failed.');

    spawnSync('pm2', ['save'], { shell: true, stdio: 'inherit' });

    banner([
      '✓ BFrost running under PM2.',
      `  Dashboard: http://127.0.0.1:3030`,
      `  Logs:      ${LOG_FILE}`,
      '',
      '  To enable auto-start on boot, run:',
      '    pm2 startup',
      '  …and follow the printed instruction.',
      '  To remove:  npm run uninstall-service',
    ]);
  } else {
    // Fallback: Windows Task Scheduler (runs at login, no crash-restart).
    const wrapperPath = path.join(ROOT, 'scripts', '_bfrost-service.cmd');
    writeFileSync(
      wrapperPath,
      `@echo off\n:loop\n"${NODE}" "${ENTRY}"\ntimeout /t 5 /nobreak >nul\ngoto loop\n`,
    );

    const result = spawnSync(
      'schtasks',
      ['/create', '/tn', 'BFrost', '/tr', `"${wrapperPath}"`, '/sc', 'onlogon', '/f'],
      { shell: true, stdio: 'inherit' },
    );
    if (result.status !== 0) {
      console.error('\nTask Scheduler registration failed.');
      console.error('Install PM2 for a better experience:  npm install -g pm2');
      console.error('Then re-run:  npm run install-service');
      process.exit(1);
    }

    banner([
      '✓ BFrost scheduled via Windows Task Scheduler (runs at login).',
      `  For crash-restart support, install PM2 (npm install -g pm2)`,
      `  and re-run: npm run install-service`,
      '',
      '  To remove:  npm run uninstall-service',
    ]);
  }
} else {
  fail(`Unsupported platform: ${process.platform}. Install manually using the README instructions.`);
}
