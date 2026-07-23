#!/usr/bin/env bash
# Starts backend + frontend dev servers bound to 0.0.0.0 so other devices on
# the LAN can reach them. Backend gets HOST=0.0.0.0 via env; frontend gets
# --host 0.0.0.0 via CLI flag only (not env), because vite.config.ts also
# reads process.env.HOST to build the dev-proxy target for /api and /oauth —
# setting that env var to 0.0.0.0 would break the proxy's connection back to
# the backend on the same machine.
#
# Before starting each server, any process already listening on its port is
# killed so re-running this script never fails with EADDRINUSE.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKEND_PORT="${PORT:-3080}"
FRONTEND_PORT="${CLIENT_PORT:-3090}"

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

free_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Port ${port} in use by PID(s) ${pids} — killing."
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    # Wait for the port to actually free up rather than racing the next listen().
    for _ in $(seq 1 20); do
      lsof -ti "tcp:${port}" >/dev/null 2>&1 || break
      sleep 0.2
    done
  fi
}

free_port "$BACKEND_PORT"
free_port "$FRONTEND_PORT"

pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

HOST=0.0.0.0 npm run backend:dev &
pids+=("$!")

(cd client && npm run dev -- --host 0.0.0.0) &
pids+=("$!")

echo ""
echo "Backend:  http://localhost:${BACKEND_PORT}"
echo "Frontend: http://localhost:${FRONTEND_PORT}"
if [ -n "$LAN_IP" ]; then
  echo "LAN access: http://${LAN_IP}:${FRONTEND_PORT}"
fi
echo ""

wait
