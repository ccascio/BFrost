#!/usr/bin/env bash
# Wrapper used by crontab. Rebuilds dist/ from scratch (so stale .js files
# from deleted/renamed src/ entries can't survive), runs the cron task, and
# pings Telegram if either the build or the task exits non-zero — so a
# silent module-load crash can't go unnoticed again.

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
fi

NODE_BIN="${NODE_BIN:-/Users/calogerocascio/.nvm/versions/node/v25.9.0/bin/node}"
NPM_BIN="${NPM_BIN:-/Users/calogerocascio/.nvm/versions/node/v25.9.0/bin/npm}"

LOG_TMP="$(mktemp -t bfrost-cron.XXXXXX)"
trap 'rm -f "$LOG_TMP"' EXIT

notify() {
  local text="$1"
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${ALLOWED_USER_ID:-}" ]; then
    return
  fi
  curl -sS -o /dev/null --max-time 10 \
    --data-urlencode "chat_id=${ALLOWED_USER_ID}" \
    --data-urlencode "text=${text}" \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" || true
}

echo "[run-cron] $(date -Iseconds) building dist/"
if ! "$NPM_BIN" run build:server >"$LOG_TMP" 2>&1; then
  cat "$LOG_TMP"
  notify "BFrost cron BUILD FAILED ($*)
$(tail -c 1500 "$LOG_TMP")"
  exit 1
fi

echo "[run-cron] $(date -Iseconds) running: node dist/cron.js $*"
set +e
"$NODE_BIN" dist/cron.js "$@" 2>&1 | tee "$LOG_TMP"
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  notify "BFrost cron FAILED ($*, exit ${status})
$(tail -c 1500 "$LOG_TMP")"
fi

exit "$status"
