#!/usr/bin/env sh
set -eu

PORT=7777

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run LocalForge."
  echo "Install Node.js 20 or newer from https://nodejs.org/ and run this script again."
  exit 1
fi

node_major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$node_major" -lt 20 ]; then
  echo "LocalForge requires Node.js 20 or newer. Found $(node --version)."
  echo "Install Node.js 20 or newer from https://nodejs.org/ and run this script again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js 20 or newer from https://nodejs.org/ and run this script again."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  if [ -f "package-lock.json" ]; then
    npm ci
  else
    npm install
  fi
fi

echo "Applying database migrations..."
npm run db:migrate

echo "Checking port $PORT..."
if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
elif command -v fuser >/dev/null 2>&1; then
  pids="$(fuser "$PORT"/tcp 2>/dev/null || true)"
else
  echo "Cannot check port $PORT because neither lsof nor fuser is installed."
  exit 1
fi

if [ -n "$pids" ]; then
  echo "Stopping process(es) on port $PORT: $pids"
  kill $pids 2>/dev/null || true
  sleep 2
  if command -v lsof >/dev/null 2>&1; then
    remaining="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  else
    remaining="$(fuser "$PORT"/tcp 2>/dev/null || true)"
  fi
  if [ -n "$remaining" ]; then
    echo "Force stopping process(es) on port $PORT: $remaining"
    kill -9 $remaining 2>/dev/null || true
  fi
fi

echo "Starting LocalForge at http://localhost:$PORT"
exec npm run dev
