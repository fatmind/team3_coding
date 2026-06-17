#!/bin/bash
# Team3 Daemon - Environment Setup & Start Script
# Usage: ./init.sh
# This script is idempotent - safe to run multiple times

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=============================="
echo " Team3 Daemon - Init & Start"
echo "=============================="

# 1. Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null || echo "none")
if [ "$NODE_VERSION" = "none" ]; then
  echo "[ERROR] Node.js is not installed. Please install Node.js >= 20.0.0"
  exit 1
fi
echo "[OK] Node.js version: $NODE_VERSION"

# 2. Install dependencies (idempotent)
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
  echo "[INFO] Installing dependencies..."
  npm install --prefer-offline --no-audit --no-fund
else
  echo "[OK] Dependencies already installed"
fi

# 3. Kill any existing daemon on the same port
DAEMON_PORT="${DAEMON_PORT:-3100}"
EXISTING_PID=$(lsof -ti:$DAEMON_PORT 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
  echo "[INFO] Killing existing process on port $DAEMON_PORT (PID: $EXISTING_PID)"
  kill $EXISTING_PID 2>/dev/null || true
  sleep 1
fi

# 4. Start daemon in background
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/daemon_$(date +%Y-%m-%d).log"

echo "[INFO] Starting daemon on port $DAEMON_PORT..."
nohup node src/daemon.js > "$LOG_FILE" 2>&1 &
DAEMON_PID=$!

# Wait briefly to check if it started successfully
sleep 1
if kill -0 $DAEMON_PID 2>/dev/null; then
  echo ""
  echo "=============================="
  echo " Daemon Started Successfully"
  echo "=============================="
  echo " Port:     $DAEMON_PORT"
  echo " PID:      $DAEMON_PID"
  echo " Log:      $LOG_FILE"
  echo " WebSocket: ws://localhost:$DAEMON_PORT"
  echo ""
  echo " Stop:     kill $DAEMON_PID"
  echo " Logs:     tail -f $LOG_FILE"
  echo "=============================="
else
  echo "[ERROR] Daemon failed to start. Check log: $LOG_FILE"
  cat "$LOG_FILE" 2>/dev/null
  exit 1
fi
