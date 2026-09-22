/**
 * Install this project as an OS background service.
 *
 * macOS  → launchd LaunchAgent  (~/Library/LaunchAgents/net.<slug>.server.plist)
 * Linux  → systemd user service (~/.config/systemd/user/<slug>.service)
 * Windows→ PM2 (preferred) or Task Scheduler fallback
 *
 * The service starts automatically at login and restarts on crash. Service identity is
 * per-project (derived from package.json name) — see scripts/service-config.mjs — so a
 * fork does not collide with the upstream project's service.
 *
 * Usage: npm run install-service
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_MAX_LOG_BYTES, DEFAULT_LOG_ROTATIONS } from './logging.mjs';
import { service } from './service-config.mjs';

const {
  ROOT, ENTRY, NODE, LOG_FILE, PORT, LABEL, PLIST_PATH,
  SYSTEMD_UNIT, SYSTEMD_PATH, PM2_NAME, WIN_TASK, WIN_WRAPPER, DISPLAY,
} = service;
const RUNNER = path.join(ROOT, 'scripts', 'run-server.mjs');
const LAUNCHER_LOG_FILE = `${LOG_FILE}.launcher`;

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
  mkdirSync(path.dirname(PLIST_PATH), { recursive: true });

  writeFileSync(
    PLIST_PATH,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${RUNNER}</string>
  </array>
  <key>WorkingDirectory</key>  <string>${ROOT}</string>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>${LAUNCHER_LOG_FILE}</string>
  <key>StandardErrorPath</key> <string>${LAUNCHER_LOG_FILE}</string>
</dict>
</plist>`,
  );

  // Unload first so a re-install doesn't leave a stale entry.
  try {
    execFileSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' });
  } catch { /* not previously loaded — fine */ }

  try {
    execFileSync('launchctl', ['load', PLIST_PATH], { stdio: 'inherit' });
  } catch (err) {
    fail(`launchctl load failed: ${err.message}`);
  }

  banner([
    `✓ ${DISPLAY} service installed (macOS launchd).`,
    `  Plist:     ${PLIST_PATH}`,
    `  Dashboard: http://127.0.0.1:${PORT}`,
    `  Logs:      ${LOG_FILE}  →  npm run logs`,
    `  Rotation:  ${DEFAULT_MAX_LOG_BYTES} bytes, ${DEFAULT_LOG_ROTATIONS} retained file(s)`,
    '',
    '  The service starts automatically at login and restarts on crash.',
    '  To remove:  npm run uninstall-service',
  ]);
}

// ---------------------------------------------------------------------------
// Linux — systemd user service
// ---------------------------------------------------------------------------
else if (process.platform === 'linux') {
  mkdirSync(path.dirname(SYSTEMD_PATH), { recursive: true });

  writeFileSync(
    SYSTEMD_PATH,
    `[Unit]
Description=${DISPLAY} local AI server
After=network.target

[Service]
ExecStart=${NODE} ${RUNNER}
WorkingDirectory=${ROOT}
Restart=on-failure
RestartSec=5
StandardOutput=append:${LAUNCHER_LOG_FILE}
StandardError=append:${LAUNCHER_LOG_FILE}

[Install]
WantedBy=default.target
`,
  );

  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
    execFileSync('systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT], { stdio: 'inherit' });
  } catch (err) {
    fail(
      `systemctl failed: ${err.message}\n` +
      'Ensure systemd user sessions are enabled (loginctl enable-linger $USER).',
    );
  }

  banner([
    `✓ ${DISPLAY} service installed (systemd user service).`,
    `  Unit:      ${SYSTEMD_PATH}`,
    `  Dashboard: http://127.0.0.1:${PORT}`,
    `  Logs:      ${LOG_FILE}  →  npm run logs`,
    `  Rotation:  ${DEFAULT_MAX_LOG_BYTES} bytes, ${DEFAULT_LOG_ROTATIONS} retained file(s)`,
    `  Status:    systemctl --user status ${SYSTEMD_UNIT}`,
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
    spawnSync('pm2', ['delete', PM2_NAME], { shell: true, stdio: 'ignore' });

    const start = spawnSync(
      'pm2',
      ['start', RUNNER, '--name', PM2_NAME, '--cwd', ROOT,
        '--output', LAUNCHER_LOG_FILE, '--error', LAUNCHER_LOG_FILE],
      { shell: true, stdio: 'inherit' },
    );
    if (start.status !== 0) fail('pm2 start failed.');

    spawnSync('pm2', ['save'], { shell: true, stdio: 'inherit' });

    banner([
      `✓ ${DISPLAY} running under PM2.`,
      `  Dashboard: http://127.0.0.1:${PORT}`,
      `  Logs:      ${LOG_FILE}`,
      `  Rotation:  ${DEFAULT_MAX_LOG_BYTES} bytes, ${DEFAULT_LOG_ROTATIONS} retained file(s)`,
      '',
      '  To enable auto-start on boot, run:',
      '    pm2 startup',
      '  …and follow the printed instruction.',
      '  To remove:  npm run uninstall-service',
    ]);
  } else {
    // Fallback: Windows Task Scheduler (runs at login, no crash-restart).
    writeFileSync(
      WIN_WRAPPER,
      `@echo off\n:loop\n"${NODE}" "${RUNNER}"\ntimeout /t 5 /nobreak >nul\ngoto loop\n`,
    );

    const result = spawnSync(
      'schtasks',
      ['/create', '/tn', WIN_TASK, '/tr', `"${WIN_WRAPPER}"`, '/sc', 'onlogon', '/f'],
      { shell: true, stdio: 'inherit' },
    );
    if (result.status !== 0) {
      console.error('\nTask Scheduler registration failed.');
      console.error('Install PM2 for a better experience:  npm install -g pm2');
      console.error('Then re-run:  npm run install-service');
      process.exit(1);
    }

    banner([
      `✓ ${DISPLAY} scheduled via Windows Task Scheduler (runs at login).`,
      `  For crash-restart support, install PM2 (npm install -g pm2)`,
      `  and re-run: npm run install-service`,
      '',
      '  To remove:  npm run uninstall-service',
    ]);
  }
} else {
  fail(`Unsupported platform: ${process.platform}. Install manually using the README instructions.`);
}
