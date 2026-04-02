#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Resetting dev environment..."
echo "Project: $ROOT_DIR"

kill_port_if_needed() {
  local port="$1"
  local pids
  pids="$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "Stopping process(es) on port $port: $pids"
    # shellcheck disable=SC2086
    kill $pids || true
    sleep 1
  fi
}

# Stop stale dev servers that commonly conflict with this workspace.
kill_port_if_needed 3000
kill_port_if_needed 3001
kill_port_if_needed 8080

echo "Clearing Next.js build caches..."
rm -rf "$ROOT_DIR/apps/admin-web/.next"
rm -rf "$ROOT_DIR/apps/public-web/.next"

echo "Starting fresh dev servers..."
pnpm dev
