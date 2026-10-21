# ErgoSense: CONTEXT (progress tracker)

Update this file at the end of every module. Both Claude and Cursor read it first.

## Module status
- [x] M1 Foundation + Auth + App shell (done)
- [x] M2 Monitoring engine + live stream (done)
- [ ] M3 Calibration + AI brain + sessions (Claude) - backend complete, session/break tracking live
- [x] M4 Dashboard + Posture pages (done) - Dashboard + Posture wired to the live WebSocket and the shared webcam
- [x] M5 Auto-brightness + Voice + Lighting & Alerts/Settings pages (done)
- [ ] M6 Sessions & History pages + Demo mode + README (Cursor) - backend endpoints complete; Sessions, History and Alerts demo controls are built

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
- `tests/test_actions.py`: unit tests for the brightness curve, decision layer, sensors, voice gating, the runtime snapshot, the browser-lux preference and the welcome/self-heal paths (all 55 backend tests pass).

Frontend (`frontend/src/`):
- `hooks/useLive.ts` opens the `/ws/live` socket (auto-reconnect, clean close) and `monitoring/MonitoringProvider.tsx` owns the single socket for the whole shell, exposing `{data, connected, start, stop}`.
- `components/Topbar.tsx`: real Monitoring Start/Stop button with a live connection dot.
- `pages/Lighting.tsx`: live lux + comfort-zone band/status, the real lux->brightness curve with a moving live dot (data from `GET /lighting/curve`), Auto/Manual toggle + manual slider, lux/target trend chart, ESP32/mock badges.
- `pages/Alerts.tsx`: alert timeline with type filters and empty state, Test voice, snooze 15/30/60 + unmute, and preference toggles (voice, auto-brightness) that persist via `PUT /settings`.
- `pages/Dashboard.tsx`: now reads the live snapshot from the context instead of polling; no `Math.random`. Rewritten this session to the shared-camera/`CameraPreview` layout with Score/Posture/Light/Drift stat cards and device badges.

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

## Posture / lighting / voice / Ergo fixes (this session)
- **Posture features were meaningless in real mode.** `neck_angle` and `head_forward` were the *same* number (`nose.y - shoulderMidY`), so head-forward did nothing, and `distance_proxy` was just shoulder width (normalised, near-constant — "sitting closer" changed nothing). Rewrote the browser feature extraction in `hooks/usePostureTracking.ts`:
  - `neck_angle` = `nose.y - shoulderMidY` (image-y gap; upright = negative, leaning forward increases it — "more = worse", which the backend score/drift already assume).
  - `head_forward` = `shoulderMidZ - nose.z` (nose depth relative to the shoulders), now genuinely distinct from the neck angle.
  - `distance_proxy` = shoulder width + shoulder-depth term, so it actually responds to leaning in/out.
  These match the unmodified scoring brain (`scoring.py` penalises positive z; `posture.py` uses signed z for `higher_is_worse` features).
- **One app-wide camera for posture *and* ambient light.** The webcam now runs in `MonitoringProvider` via the new `usePostureCamera(enabled)` hook whenever real mode is monitoring (plus on demand for calibration via `requestCamera`). Posture, Dashboard and Calibration render a shared `CameraPreview` instead of each opening their own camera. This removes the old duplicate un-scored `usePostureTracking` camera (Dashboard rewritten with it).
- **Ambient light from the webcam (phone-style, no ESP32 needed).** The same hook averages frame luminance (32×24 canvas) → `luminanceToLux()` → feeds `lux` to `POST /api/monitor/feed`. New runtime logic `_prefer_browser_lux()` uses the webcam estimate whenever the ESP32 reader reports `mock`/`disconnected` (i.e. no real hardware), and reports the device as `webcam`. A real ESP32 (`ok`) always wins. Lighting page copy/badges updated; auto-brightness now visibly tracks the light because the lux actually varies in real mode (verified: `screen_brightness_control` moved the screen 57%→30%). Mock lux still works via the Alerts demo slider.
- **Sessions page** now opens with a short "What Sessions does" card (what a session is, how work time and auto-breaks work, the manual "I took a break" button, and the saved average score).
- **Voice** was already wired (drift → `decide.decide_actions` → `_act` → `VoiceEngine.speak`, plus `POST /api/alerts/test-voice` with `force=True`, and mute/unmute). Confirmed live: test-voice returns `spoken: true` on this machine; drift/low-light/long-session voice is covered by `test_decide_*` + `test_voice_gating_and_mute`.
- **New floating "Ergo" companion** (`components/ErgoCompanion.tsx`, mounted in `Layout`): a small bottom-right window showing the live Ergo Score, any drift alert, the current insight, and a voice on/off toggle. Minimises to a score bubble; open/closed state persists in localStorage. Hidden when logged out (it lives inside `Layout`).

## Voice, companion & background-monitoring changes (this session)
- **Voice now speaks up (and greets you).** Cooldowns were far too long (`voice_cooldown_seconds` 180→25, `voice_repeat_seconds` 600→90) so Ergo went silent after one line. Added `voice_welcome_text` in `config.py`, a `welcome` branch in `decide.decide_actions`, and `UserRuntime.welcome()` which speaks the greeting with `force=True` (bypasses cooldowns) and logs a `voice` event. `POST /api/monitor/start` now calls it, so pressing Start plays: *"Welcome! I am Ergo… you can mute me any time."* Drift/low-light/long-session prompts then flow through the normal decision path on every tick.
- **Ergo is now an always-on-top companion (Document Picture-in-Picture).** `components/ErgoCompanion.tsx` pops the widget into a `documentPictureInPicture.requestWindow(...)` window (Chrome/Edge) via a React portal, copying the page styles so Tailwind renders. It floats over YouTube/Word/etc. There's a "Pop out" chevron in the header; closing the PiP window (✕ or the OS close) falls back to the in-page floating widget; minimise still collapses to the score bubble. Browsers without the API use the in-page widget. The header floats over other apps — click the small "Ergo ↗" pill on the page to refocus it.
- **Monitoring keeps running when the app is not focused.** The hidden detection `<video>` is now moved *into* the PiP document while it is open (`attachDetectionVideo`), because a visible surface is not throttled by the browser; `usePostureTracking` also stops skipping frames when `document.hidden` while a PiP window is open (`setPipActive`). The WebSocket already stays connected in the background. Net effect: the session, posture/light feed and alerts continue until you press **Stop** — switching to another window no longer looks like a stop.
- Note: background monitoring requires the companion to be popped out (or the tab visible); without a visible surface the browser pauses the camera, which is a browser limitation, not an app one.

## Voice reliability, real companion window & baseline sensitivity (this session)
- **Voice said "not supported".** The listening backend had been started from a Python without `pyttsx3` (the venv launcher spawns the base interpreter as a child on Windows, and a stale server was still bound to :8000). Fixed two ways: (1) the backend is now always started from `backend\.venv`; (2) `VoiceEngine` is **self-healing** — `_try_init()`/`retry()` re-attempt `pyttsx3.init()` on every `speak()`/`test-voice` and after any utterance error, and `stop()` clears the engine so the next session re-inits cleanly. `POST /api/alerts/test-voice` calls `retry()` first, so a transient audio hiccup can never silence voice for the whole session. Verified live: `test-voice` → `spoken: true`, and Start speaks the welcome.
- **Companion would not stay over other apps.** It only popped out if you found and clicked a tiny chevron. Now: it **auto-pops out into the always-on-top Document Picture-in-Picture window the first time monitoring starts** (Chrome/Edge), the header button is a clear "Float" control, all PiP calls are guarded, and failures show an explicit message ("use Chrome or Edge"). Closing the window remembers the choice (`ergosense_ergo_pip_dismissed`) and falls back to the in-page widget. While popped out, a small "Ergo ↗ always on top" pill sits on the page to refocus the window. The detection `<video>` is moved into the PiP document so the browser keeps the camera running when the tab is hidden.
- **"Screen distance" and "head forward" read red even when sitting well.** Root cause: a calm calibration made the baseline std-dev tiny (e.g. `distance_proxy` std 0.0066), so a normal ~0.03 shift scored 4-5 sigma → red. Added per-feature **minimum std-dev floors** (`baseline_std_floor_*` in `config.py`) applied both when building a baseline (`compute_baseline(std_floors=…)`) and when rehydrating stored ones (`stats_from_json(..., std_floors=…)`), so existing baselines stop being hyper-sensitive immediately. Also note: the webcam feature formulas changed in the previous session, so an old baseline should be rebuilt by re-running Calibration for accurate results.

## Voice playback fix: SAPI → WAV → winsound (this session) — CONFIRMED WORKING
- **Symptom.** `POST /api/alerts/test-voice` returned `spoken: true`, `supported: true`, the worker logged "speaking … finished" with no exception — yet nothing was audible in the served app. The *same* pyttsx3 calls were audible when run as a standalone script in the venv.
- **Root cause.** pyttsx3's SAPI5 driver speaks via COM **events** plus a message pump (`comtypes.client.GetEvents` + `PumpWaitingMessages`) started from a worker thread. In a long-running/server process the `EndStream` event fires (so `runAndWait()` returns and pyttsx3 reports success) but no audio reaches the default device — a classic pyttsx3-from-a-background-process failure. It is not a device/permissions problem (standalone playback is fine).
- **Fix (verified audible in the served app).** New `engine/actuators/sapi.py` uses `win32com` to render the sentence to a temporary `.wav` with SAPI's `SpFileStream` (no device needed), then plays it with **`winsound.PlaySound`** — both steps work from any thread/process. `VoiceEngine._speak_once()` tries `sapi.speak_wav()` first and falls back to pyttsx3 only if that stack is missing. COM is created and used inside the single call, so there is no cross-thread affinity issue. `requirements.txt` now lists `pywin32` (for `win32com`/`pythoncom`); on non-Windows/headless hosts `sapi.available()` is False and voice degrades to pyttsx3 or a silent no-op as before.


## Camera + WebSocket fixes (this session) — CONFIRMED WORKING
- **Symptom 1: the Calibration page showed `Camera error: Failed to fetch`.** The webcam was fine; the *pose model* was not. MediaPipe downloads `pose_landmarker_lite.task` from `storage.googleapis.com`, and that fetch failed in the browser (firewall/ad-blocker/offline), so the raw `TypeError: Failed to fetch` was shown as a camera error. Reproduced exactly by blocking `*.task` over CDP.
- **Fix: the MediaPipe runtime is now served by the app itself.** `frontend/public/mediapipe/` holds `manifest.json` + `pose_landmarker_lite.task` (committed) and `wasm/` (copied out of `node_modules/@mediapipe/tasks-vision/wasm` by `frontend/scripts/setup-mediapipe-assets.mjs`, which also runs on `npm install` via `postinstall`; `wasm/` is git-ignored). `hooks/usePostureTracking.ts` reads the manifest, tries the local runtime first and only falls back to the public CDN if the local copy is missing/broken. Verified: the pose model now loads from `localhost:5173/mediapipe/...` with **zero** CDN requests.
  - The manifest (instead of `HEAD`-probing the big files) avoids Vite's SPA fallback: an unknown path answers 200 + `text/html`, and a `HEAD` probe of a 5.5 MB file shows up in DevTools as a bogus `net::ERR_ABORTED`.
  - `npm run setup:mediapipe` re-downloads the model if it is ever deleted.
- **Symptom 2: Vite printed `[vite] ws proxy socket error: write ECONNABORTED`.** React `StrictMode` mounts twice, so `useLive` created a `/ws/live` socket and closed it again *while it was still handshaking*. Chrome logs `WebSocket is closed before the connection is established.` and the aborted handshake makes the dev proxy abort its socket to the backend.
- **Fix: one app-wide WebSocket singleton.** `hooks/useLive.ts` now keeps the socket in module scope (ref-counted, auto-reconnecting with a backoff, closed ~1 s after the last consumer unmounts so a StrictMode remount never tears it down). One socket per page load, clean close, no aborted handshakes.
- **`backend/app/routers/ws.py`** now runs a `receive_text()` watcher next to the send loop, so a browser disconnect is noticed immediately and the socket is closed cleanly instead of being dropped mid-stream.
- **`frontend/vite.config.ts`**: the `/ws` proxy now also uses `changeOrigin: true`.
- **The camera error is now actionable.** `usePostureTracking` classifies failures into `camera` vs `model` (`CameraErrorKind`), the Calibration page shows "Camera unavailable" or "Posture model failed to load" with a **Retry camera** button, and the camera controller is a module-level singleton so React remounts never reopen the webcam. `MonitoringProvider` exposes `cameraErrorKind` + `retryCamera`.
- Verified in a real browser (headless Edge over CDP): no `Camera error`, no `WebSocket is closed before the connection is established.`, no vite proxy error, `Graph successfully started running.` (model ready), `npm run build` + `npm run lint` clean, backend suite 55/55.


## Known issues / notes
- `scripts/run_dev.bat` was written for Windows but could only be tested on Linux (the `.sh` twin was tested). First Windows run may need a small fix.
- `requirements.txt` now lists pyserial, pyttsx3, screen-brightness-control and pywin32 (Windows-only). MediaPipe/OpenCV are not needed on the backend (pose runs in the browser).
- The browser now needs `frontend/public/mediapipe/` to be populated: run `npm install` in `frontend/` (the `postinstall` script copies the wasm runtime and writes the manifest). The pose model is committed, so only the wasm runtime is generated. Without it the app still works — it falls back to the public MediaPipe CDN, which is what failed in the first place.
- The Alerts/Settings page exposes the controls the backend supports today (voice on/off, auto-brightness, snooze). Spec items that need new endpoints (change password, score-weight sliders, reset baseline, quiet hours) are deferred to M6.
- Real-mode posture depends on the browser posting frames to `/api/monitor/feed`. This now happens app-wide while real mode is monitoring (via `MonitoringProvider`); the same frames also carry the webcam ambient-light estimate. Without them, the camera badge shows `off` (mock mode is always complete).
- Drift in mock mode still waits for `drift_enter_minutes` (2 min) before flagging, so the drift *badge* is slow to appear even though the posture numbers move immediately. Voice now speaks the welcome immediately on Start and posts drift/low-light/long-session prompts within ~25s of the condition (cooldowns shortened).
- Login token lives in localStorage (fine for a local student project; httpOnly cookies would be the hardened option).
- Login has no rate limiting yet (planned for M6).
