#!/usr/bin/env bash
# ErgoSense: start backend + frontend (Mac / Linux).
# Run from the project root:   bash scripts/run_dev.sh
set -e
cd "$(dirname "$0")/.."

PY=python3
command -v python3.12 >/dev/null 2>&1 && PY=python3.12

if [ ! -x backend/.venv/bin/python ]; then
  echo "[1/4] Creating Python environment (first time only)..."
  $PY -m venv backend/.venv
fi
echo "[2/4] Installing backend packages..."
backend/.venv/bin/python -m pip install -q -r backend/requirements.txt

[ -f backend/.env ] || cp backend/.env.example backend/.env

if [ ! -d frontend/node_modules ]; then
  echo "[3/4] Installing frontend packages (first time only)..."
  (cd frontend && npm install)
fi

echo "[4/4] Starting servers. Press Ctrl+C to stop both."
(cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000) &
BACK=$!
(cd frontend && npm run dev) &
FRONT=$!
trap 'kill $BACK $FRONT 2>/dev/null' EXIT INT TERM
echo "Open http://localhost:5173"
wait
