# ErgoSense: CONTEXT (progress tracker)

Update this file at the end of every module. Both Claude and Cursor read it first.

## Module status
- [x] M1 Foundation + Auth + App shell (done)
- [x] M2 Monitoring engine + live stream (done)
- [ ] M3 Calibration + AI brain + sessions (Claude) - backend complete, session/break tracking live
- [ ] M4 Dashboard + Posture pages (Cursor) - Dashboard wired to the live WebSocket
- [x] M5 Auto-brightness + Voice + Lighting & Alerts/Settings pages (done)
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
- Top bar shows live backend status from `/api/health` plus the Monitoring Start/Stop button and a live-socket dot (M2).
- Python target is 3.12 (MediaPipe compatibility). `requirements.txt` now includes pyserial, pyttsx3 and screen-brightness-control for M2/M5.

## What exists after M2 + M5
Backend (`backend/app/`):
- `engine/runtime.py`: `UserRuntime` runs the full loop (Sense -> baseline EMA -> drift -> fuse -> score -> explain -> act -> persist) on a ~1 Hz background thread per user; `RuntimeManager` (`manager`) owns one runtime per user and stops them all on shutdown. `snapshot()` returns the exact live shape the frontend expects.
- `engine/sensors/`: `mock.py` (synthetic posture + lux, optional visible drift), `light.py` (pyserial `LUX:` reader + mock), `webcam.py` (holds the last browser-posted posture frame).
- `engine/actuators/`: `brightness.py` (log-like lux->% curve, deadband + rate limit, manual-pause, graceful "unsupported"), `voice.py` (pyttsx3 worker queue, cooldowns, mute, no-op when unavailable).
- `engine/core/decide.py`: pure `decide_actions(state)` -> speak on sustained drift / low light / long session.
- Routers: `ws.py` (`WS /ws/live?token=<jwt>`), `lighting.py` (`GET /api/lighting/summary|curve`, `POST /api/lighting/mode|brightness`), `settings.py` (`GET/PUT /api/settings`), `alerts.py` (`GET /api/alerts`, `POST /api/alerts/test-voice|mute|unmute`), `monitor.py` (rewritten on the runtime: `/live`, `/start`, `/stop`, `/feed`, `/mock`, `/events`).
- `prefs.py` persists per-user settings (voice on/off, brightness mode, manual %). `schemas.py` has `LightingSummary/LightingCurvePoint`, `SettingsOut/Update`, `MuteRequest`, `MockRequest`. `main.py` wires the new routers and calls `manager.stop_all()` on shutdown.
- `tests/test_actions.py`: unit tests for the brightness curve, decision layer, sensors, voice gating and the runtime snapshot (all 29 backend tests pass).

Frontend (`frontend/src/`):
- `hooks/useLive.ts` opens the `/ws/live` socket (auto-reconnect, clean close) and `monitoring/MonitoringProvider.tsx` owns the single socket for the whole shell, exposing `{data, connected, start, stop}`.
- `components/Topbar.tsx`: real Monitoring Start/Stop button with a live connection dot.
- `pages/Lighting.tsx`: live lux + comfort-zone band/status, the real lux->brightness curve with a moving live dot (data from `GET /lighting/curve`), Auto/Manual toggle + manual slider, lux/target trend chart, ESP32/mock badges.
- `pages/Alerts.tsx`: alert timeline with type filters and empty state, Test voice, snooze 15/30/60 + unmute, and preference toggles (voice, auto-brightness) that persist via `PUT /settings`.
- `pages/Dashboard.tsx`: now reads the live snapshot from the context instead of polling; no `Math.random`.

## Bug fixes (post-M3, this session)
- `routers/monitor.py`: imported `WorkSession` (POST `/api/monitor/start` was 500) and fixed `deque` slicing in the insight call (POST `/api/monitor/feed` was 500 on every call).
- Calibration sample flow: added `POST /api/calibration/sample` (+ `CalibrationSampleRequest` in `schemas.py`). The Calibration page now posts there instead of `/monitor/feed`, which never fed the `CalSession`.
- `routers/calibration.py`: imported `BaselineStats` and removed the dead `if False else` branch in `GET /api/calibration/baseline` (would 500 once a baseline existed).
- `engine/core/drift.py`: hysteresis exit now clears once the *recent* readings (last `enter_minutes`) fall inside the exit threshold, instead of keeping the user flagged while old high samples sit in the trend window. `test_drift_hysteresis_exit` now passes (17/17).
- `pages/Dashboard.tsx`: removed `Math.random()` ambient light; it now polls `GET /api/monitor/live` (score, lux, insight, device badges) with a real empty state.
- `engine/runtime.py`: the live loop crashed every tick on `self._score_history[:-1]` (`deque` cannot be sliced), so Explain/Act/persist never ran (no insights, no alerts, no samples). Extracted `_previous_score_avg()` (copies to a list first) and added a regression test `test_previous_score_avg_excludes_newest_from_deque`.

## Calibration fixes (this session)
- **Calibration stayed at `0 samples` forever.** `Calibration.tsx` rendered its `<video>` only *after* Start, but `useRawPosture` opens the camera and attaches the stream once at page mount — `videoRef.current` was `null`, so the stream was never attached and no frame was ever read. The `<video>` is now always in the DOM (hidden outside the sampling step), and `useRawPosture` waits for it to exist before attaching/playing. `isReady` is now only true once the video is actually playing, so the Start button can no longer enable itself in that broken state.
- Sample-POST errors were swallowed by `.catch(() => {})`; they now show a message, and the calibrating step shows a "No samples yet" hint.
- `finish()` guessed the end from its own timer (could return `failed` while the server was still running); it now polls `/api/calibration/status` until the backend reports `running: false`.
- A stale session from a closed tab caused a `409` that silently blocked Start; `start()` now cancels the stale session and retries once.
- `useRawPosture` sent `movement: 0.01` (constant), which made the fidget check useless and the quality score fake. It now measures real frame-to-frame change. Sample posting is throttled to ~7/s (was ~30/s).

## Known issues / notes
- `scripts/run_dev.bat` was written for Windows but could only be tested on Linux (the `.sh` twin was tested). First Windows run may need a small fix.
- `requirements.txt` now lists pyserial, pyttsx3 and screen-brightness-control. MediaPipe/OpenCV are not needed on the backend (pose runs in the browser).
- The Alerts/Settings page exposes the controls the backend supports today (voice on/off, auto-brightness, snooze). Spec items that need new endpoints (change password, score-weight sliders, reset baseline, quiet hours) are deferred to M6.
- Real-mode posture depends on the browser posting frames to `/api/monitor/feed`; without that, real mode shows the camera badge as `off` (mock mode is always complete).
- Drift in mock mode still waits for `drift_enter_minutes` (2 min) before flagging, so the drift *badge* is slow to appear even though the posture numbers move immediately.
- Login token lives in localStorage (fine for a local student project; httpOnly cookies would be the hardened option).
- Login has no rate limiting yet (planned for M6).
