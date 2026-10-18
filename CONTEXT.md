# ErgoSense: CONTEXT (progress tracker)

Update this file at the end of every module. Both Claude and Cursor read it first.

## Module status
- [x] M1 Foundation + Auth + App shell (done)
- [ ] M2 Monitoring engine + live stream (Claude)
- [ ] M3 Calibration + AI brain + sessions (Claude)
- [ ] M4 Dashboard + Posture pages (Cursor)
- [ ] M5 Auto-brightness + Voice + Lighting & Alerts/Settings pages (Cursor, Claude if stuck)
- [ ] M6 Sessions & History pages + Demo mode + README (Cursor)

## How to run
- Windows: `.\scripts\run_dev.bat` from the project root (starts backend :8000 and frontend :5173, opens the browser).
- Mac/Linux: `bash scripts/run_dev.sh`
- Backend tests: `cd backend` then `.venv\Scripts\python -m pytest -q` (Windows) / `.venv/bin/python -m pytest -q`
- API docs: http://localhost:8000/docs
- Config: `backend/.env` (copied from `backend/.env.example`). `ERGOSENSE_MOCK=1` = simulated sensors.

## What exists after M1
Backend (`backend/app/`):
- `main.py` app factory + CORS + `GET /api/health` (returns `status`, `mock`, `app`).
- `config.py` single `settings` object (all tunables go here). `database.py` SQLAlchemy engine/session/`init_db()`.
- `models.py` tables: User, Baseline, Sample, Event, WorkSession, UserSetting (all but User have `user_id`).
- `schemas.py` Pydantic request/response models. `security.py` bcrypt, JWT, `get_current_user`, `get_user_from_token` (for the M2 WebSocket).
- `routers/auth.py`: `POST /api/auth/register`, `/login`, `/logout`, `GET /api/auth/me`.
- `tests/test_auth.py`: 11 tests, in-memory DB (never touches the real file).

Frontend (`frontend/src/`):
- `api/client.ts` fetch wrapper (`api<T>(path, {method, body, auth})`, token in localStorage, 401 triggers logout).
- `auth/` AuthProvider, `useAuth()`, `ProtectedRoute`, `GuestRoute`.
- `components/` Layout (collapsible sidebar + top bar + mobile drawer), Icon, Logo, ThemeToggle, TextField, AuthShell, ComingSoon, PageHeader.
- `pages/` Login, Register, Dashboard (real system check), and placeholder pages: Posture, Lighting, Sessions, History, Alerts, Calibration.
- Vite dev server proxies `/api` and `/ws` to the backend at 127.0.0.1:8000, so the frontend always calls relative URLs like `/api/...`.

## Decisions made
- Register also logs the user in (returns a token) to avoid an extra step.
- bcrypt is used directly (not passlib, which breaks with newer bcrypt). Passwords are limited to 72 bytes (bcrypt limit).
- Tailwind v4 via `@tailwindcss/vite`; dark mode = `dark` class on `<html>`, saved in localStorage.
- Placeholder pages show no numbers, only what the page will contain and which module builds it.
- Top bar shows live backend status from `/api/health`. The monitoring Start/Stop button arrives with M2.
- Python target is 3.12 (MediaPipe compatibility). Added packages for later modules (opencv, mediapipe, pyserial, pyttsx3, screen_brightness_control) are NOT in `requirements.txt` yet; add them in M2/M5.

## Known issues / notes
- `scripts/run_dev.bat` was written for Windows but could only be tested on Linux (the `.sh` twin was tested). First Windows run may need a small fix.
- `reference/qwen_old/` (the earlier attempt's Python engine) is not in the repo. M2 builds the engine fresh and does not need it.
- Login token lives in localStorage (fine for a local student project; httpOnly cookies would be the hardened option).
- Login has no rate limiting yet (planned for M6).
