#!/usr/bin/env bash
#
# init.sh - LocalForge development environment setup & launch script
#
# Purpose:
#   Installs Node.js dependencies (if missing), applies Drizzle migrations to the
#   SQLite database, and starts the Next.js dev server on port 3000.
#
# Usage:
#   ./init.sh                  # install + migrate + start dev server (foreground)
#   ./init.sh --background     # start dev server in the background, return pid
#   ./init.sh --build          # install + migrate + run production build
#
# Requirements:
#   - Node.js 20+
#   - npm (ships with Node)
#   - LM Studio running at http://127.0.0.1:1234 (for agent features to work)
#
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

PORT="${PORT:-3000}"
MODE="${1:-dev}"

echo "=============================================="
echo "  LocalForge init"
echo "  Project root: $PROJECT_ROOT"
echo "  Port: $PORT"
echo "=============================================="

# ---- Node.js version check ----
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not installed. Install Node.js 20+ first." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required, found $(node --version)" >&2
  exit 1
fi

# ---- Install dependencies ----
if [ ! -d "node_modules" ] || [ package.json -nt node_modules ]; then
  echo "[1/3] Installing dependencies..."
  npm install
else
  echo "[1/3] Dependencies up-to-date, skipping install."
fi

# ---- Apply database migrations ----
mkdir -p "$PROJECT_ROOT/data"
if [ -f "drizzle.config.ts" ] || [ -f "drizzle.config.js" ]; then
  echo "[2/3] Applying Drizzle migrations..."
  npx drizzle-kit migrate 2>/dev/null || npx drizzle-kit push 2>/dev/null || true
else
  echo "[2/3] No drizzle.config found yet - skipping migrations."
fi

# ---- Launch ----
echo "[3/3] Starting LocalForge..."

case "$MODE" in
  --background|-b)
    nohup npm run dev -- --port "$PORT" > dev-server.log 2>&1 &
    echo "Server started in background (PID $!). Logs: ./dev-server.log"
    echo "URL: http://localhost:$PORT"
    ;;
  --build|build)
    echo "Running production build..."
    npm run build
    echo "Starting production server..."
    npm run start -- --port "$PORT"
    ;;
  dev|*)
    echo ""
    echo "LocalForge dev server starting at http://localhost:$PORT"
    echo "Ensure LM Studio is running at http://127.0.0.1:1234"
    echo "Press Ctrl+C to stop."
    echo ""
    npm run dev -- --port "$PORT"
    ;;
esac
