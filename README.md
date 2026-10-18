# ErgoSense

An AIoT smart-workstation assistant. It watches your **posture** (laptop webcam + MediaPipe) and your
**room light** (ESP32 + BH1750), learns your personal baseline, detects gradual posture drift, produces an
explainable **Ergo Score (0-100)**, and acts automatically with **auto screen brightness** and **voice feedback**.

Core loop: **Sense → Learn baseline → Detect drift → Fuse → Score → Explain → Act → Re-evaluate**

## Status

| Module | What | State |
|---|---|---|
| M1 | Foundation, login/register, app shell | **Done** |
| M2 | Sensor engine + live stream | Next |
| M3 | Calibration + AI brain + sessions | |
| M4 | Dashboard + Posture pages | |
| M5 | Auto-brightness, voice, Lighting + Alerts/Settings | |
| M6 | Sessions + History, demo mode | |

## Quick start (Windows)

You need **Python 3.12**, **Node.js (LTS)** and **Git** installed.

In the VS Code terminal, from the project folder:

```powershell
.\scripts\run_dev.bat
```

That one command creates the Python environment, installs everything, starts the **backend (port 8000)** and the
**frontend (port 5173)** in two windows, and opens http://localhost:5173. Create an account on the Register page and
you are in. To stop, close the two black server windows.

## Quick start (Mac / Linux)

```bash
bash scripts/run_dev.sh
```

## Run the pieces by hand (if you prefer)

Backend:
```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```
API docs (try the endpoints in your browser): http://localhost:8000/docs

Frontend (in a second terminal):
```powershell
cd frontend
npm install
npm run dev
```

## Run the tests

```powershell
cd backend
.venv\Scripts\python -m pytest -q
```

## Settings

Copy `backend/.env.example` to `backend/.env` (the run script does this for you). Important values:

- `ERGOSENSE_SECRET_KEY`: signs login tokens. Change it to a long random string before sharing the app.
- `ERGOSENSE_MOCK=1`: use simulated sensors (no webcam or ESP32 needed). Set to `0` for real hardware (from M2).

`.env` and the database file are git-ignored, so secrets and personal data never reach GitHub.

## Project layout

```text
backend/    Python API (FastAPI + SQLite): auth, database, and later the sensor/AI engine
frontend/   React + Vite + TypeScript + Tailwind web app
firmware/   ESP32 code for the BH1750 light sensor (added in M2)
docs/       Module specs used to build the project step by step
scripts/    One-command start scripts
CLAUDE.md   Project rules for the AI coding tools
CONTEXT.md  Progress tracker, read by the AI tools at the start of every session
```

## Troubleshooting

- **"API offline" in the top bar:** the backend window is not running. Run the start script again.
- **Port already in use:** an old server is still running. Close old terminal windows and try again.
- **Login suddenly sends you back to the login page:** your session expired (12 hours) or the backend was reset. Log in again.
- **`py` is not recognised:** install Python 3.12 from python.org and tick "Add python.exe to PATH".
