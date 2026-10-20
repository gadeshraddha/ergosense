# ErgoSense — Full Project Report

An AIoT smart-workstation assistant. It watches your **posture** (laptop webcam + MediaPipe) and your
**room light** (ESP32 + BH1750), learns your **personal baseline**, detects **gradual posture drift**,
fuses everything into an explainable **Ergo Score (0–100)**, and acts automatically — **auto screen
brightness** and **voice feedback**. It also tracks **work sessions and breaks**.

**Core loop:** Sense → Learn baseline → Detect drift → Fuse → Score → Explain → Act → Re-evaluate

---

## PART 1 — The Basics

Four plain-English definitions:

- **Frontend** = what you see and click, running in the browser. Here: **React + TypeScript + Vite + Tailwind**.
- **Backend** = a program running on the laptop that holds the real logic, talks to hardware, writes data, and answers requests. Here: **Python + FastAPI + Uvicorn**.
- **Database** = one file that stores data permanently (`ergosense.db`, via **SQLite + SQLAlchemy**). Tables: `users`, `baselines`, `samples`, `events`, `work_sessions`, `user_settings`.
- **API / endpoint** = a URL the frontend calls (e.g. `POST /api/monitor/start`). The frontend never touches the database directly.

Connection in one line: **browser (React) ⇄ HTTP/WebSocket ⇄ backend (FastAPI) ⇄ SQLite**, and the backend also talks to **hardware** (ESP32 over USB) and **actuators** (screen brightness, speaker).

### Why two languages
- **Python backend**: best libraries for AI/hardware (MediaPipe, pyserial, pyttsx3, screen-brightness-control) + FastAPI for a clean typed API.
- **TypeScript frontend**: webcam + in-browser MediaPipe + modern UI; TypeScript catches mistakes before running.

### How the two halves talk
- **HTTP (REST)** for commands/snapshots; wrapper is `frontend/src/api/client.ts` (adds token, readable errors).
- **WebSocket `/ws/live`**: backend pushes a **live snapshot** once per second; `useLive.ts` renders instantly.

The snapshot (`backend/app/engine/runtime.py` → `snapshot()`) is the contract: `features`, `lux`, `factors`, `score`, `drift`, `insight`, `session`, `devices`.

---

## PART 2 — What we used and where

### Backend
| File | Job |
|---|---|
| `backend/app/main.py` | Builds the FastAPI app, CORS, router registration, health check |
| `backend/app/config.py` | **Every tunable number** (weights, thresholds, cooldowns, lux). Overridable via `.env` (`ERGOSENSE_` prefix) |
| `backend/app/database.py` | SQLite engine + per-request DB session (`get_db`) |
| `backend/app/models.py` | The 6 tables; every table except `User` has `user_id` |
| `backend/app/schemas.py` | Pydantic = **typed, validated** shapes on every endpoint |
| `backend/app/security.py` | bcrypt hashing, JWT tokens, `get_current_user` guard |
| `backend/app/routers/*.py` | API endpoints grouped by feature |
| `backend/app/engine/runtime.py` | **The heart**: one 1 Hz background thread per user running the loop |
| `backend/app/engine/core/*.py` | The brain: baseline, drift, scoring, fusion, explain, decide (pure math, testable) |
| `backend/app/engine/sensors/*.py` | Inputs: webcam, light (ESP32), mock |
| `backend/app/engine/actuators/*.py` | Outputs: brightness, voice, sapi |

### Frontend
| File | Job |
|---|---|
| `frontend/src/monitoring/MonitoringProvider.tsx` | Owns the single WebSocket and single shared camera; posts frames to the backend |
| `frontend/src/hooks/useLive.ts` | WebSocket client with auto-reconnect |
| `frontend/src/hooks/usePostureTracking.ts` | Runs MediaPipe Pose in the browser → 5 features + ambient lux |
| `frontend/src/api/client.ts` + `types.ts` | HTTP wrapper + TypeScript types |
| `frontend/src/pages/*.tsx` | Dashboard, Posture, Calibration, Lighting, Sessions, History, Alerts, Login/Register |
| `frontend/src/components/*` | Layout, CameraPreview, ErgoCompanion, UI kit |

### Libraries explained
FastAPI (endpoints + `/docs`), Uvicorn (server), Pydantic (validation), SQLAlchemy (DB), JWT+bcrypt (auth),
MediaPipe Pose (on-device body landmarks), pyserial (USB serial), pyttsx3/win32com SAPI (offline speech),
screen-brightness-control (screen %), React/Vite/Tailwind/Recharts (UI).

---

## PART 3 — The Working

### 3.1 Sign-in
1. Register → bcrypt-hashed password, `User` row.
2. Login → **JWT** (12h). Frontend stores it and sends it with every request + in the WebSocket URL.
3. Every protected endpoint uses `Depends(get_current_user)` → always knows *which* user → per-user data.

### 3.2 The core loop (one user, one thread, ~1 Hz)
`UserRuntime._loop` → `_tick()` each second:

1. **Sense** — mock sensors, or real webcam (browser-posted) + ESP32 lux. No real ESP32 → prefer the browser's webcam lux estimate.
2. **Learn baseline** — load the personal normal; gently nudge it via EMA only during good, non-drifting moments. Never learn bad posture.
3. **Detect drift** — rolling-window slope + sustained-offset test with hysteresis → `{level, feature, minutes}`.
4. **Score** — four factors 0–100 (posture, screen, lighting, movement), fused with weights (.35/.25/.20/.20), smoothed ~30 s.
5. **Explain** — names the factor that fell most, in one plain sentence.
6. **Act** — auto-brightness (lux→%, deadband/rate-limit) + voice (welcome, drift, dim room, long session) gated by cooldowns/mute.
7. **Re-evaluate / persist** — writes a `Sample` every ~5 s (only when present), logs `Event`s, saves the learned baseline every 60 s.

### 3.3 Webcam features (frontend AI)
From nose + both shoulders: `neck_angle`, `head_forward`, `shoulder_tilt`, `distance_proxy` (grows as you get closer), `movement` (frame-to-frame change). A 32×24 canvas brightness → `luminanceToLux()` phone-style lux. Posted to `/api/monitor/feed` every 400 ms.

### 3.4 Calibration
`POST /api/calibration/start` (150 s / 20 s demo) → samples → `compute_baseline()` computes mean/std/median/MAD per feature. Rejects bad calibrations *with a reason* (too few samples, too much movement) and applies **std-dev floors** so a calm calibration doesn't turn small shifts red. Saved as the active baseline.

---

## PART 4 — How it uses IoT

IoT = **physical devices that sense the real world, connected to software that acts on it.**

- **Sensors:** ESP32 + BH1750 streams `LUX:312.5` over USB serial (`sensors/light.py`, auto-detects port, reconnects); webcam = second sensor (vision + ambient lux).
- **Connectivity:** USB serial (device→backend) + WebSocket (backend→browser).
- **Actuators:** laptop screen (brightness) + speaker (voice).
- **Closed-loop example:** room dims → lux 180 → `lux_to_target` ~20% → `set_brightness(20)` → screen dims. World → sensor → software → world.
- **Example:** lux < 250 → automatic brightness action *and* a spoken nudge.
- **Mock/real duality:** whole system runs with no devices; switching to real plugs them in (and clears synthetic data).

> The `firmware/bh1750_reader/bh1750_reader.ino` sketch is **not present yet** — the backend is ready for it (port auto-detect + `LUX:` parsing).

---

## PART 5 — How we incorporated AI with IoT (AIoT)

| AI technique | What it does | File |
|---|---|---|
| Personal baseline (unsupervised) | Learns *your* normal from your data | `core/baseline.py` |
| z-score deviation | "How unusual is this vs you?" anomaly detection | `baseline.py:FeatureStat.z` |
| Drift detection | Least-squares slope + sustained offset + hysteresis | `core/drift.py` |
| Sensor fusion | Combines camera + light into one smoothed score | `core/fusion.py`, `scoring.py` |
| Explainable reasoning | Picks the worst factor, writes why + what it will do | `core/explain.py`, `decide.py` |
| Online learning | Baseline adapts via EMA | `baseline.py:ema_update` |
| On-edge deep learning | MediaPipe Pose: pixels → body landmarks | `usePostureTracking.ts` |

**AI↔IoT loop:** sense → z-scores vs your baseline → drift slope spots a slump → camera+light fuse → explain the cause → brightness/voice react → baseline adapts. A full perception → cognition → action loop.

---

## PART 6 — In-depth

### 6.1 Architecture
```
[Webcam] ──MediaPipe(browser)──▶ 5 features ─┐
                                             ├─▶ FastAPI backend ──▶ SQLite
[ESP32+BH1750] ──USB serial LUX:…───────────┘        │
                                                     ├─ engine/runtime.py (1 Hz loop per user)
                                                     ▼
                              WebSocket /ws/live ──▶ React UI
                                                     │
                              Actuators: brightness, speaker (SAPI→WAV→winsound)
```
- Per-user runtime; snapshot read under a lock to avoid async/thread complexity.
- Brain (`core/`) is pure → unit-testable with synthetic data.

### 6.2 Data model
`User`, `Baseline` (JSON stats, active), `Sample` (features+lux+score, timestamped), `Event` (type/severity/message), `WorkSession` (start/end/avg_score/breaks), `UserSetting`. All non-user tables carry `user_id` + CASCADE.

### 6.3 API surface
auth; monitor (live/start/stop/feed/mock/mode/events); calibration (start/sample/status/cancel/baseline); posture (summary/trend); lighting; alerts (timeline/test-voice/mute/unmute); sessions (list/current/break); history; ws `/ws/live`.

### 6.4 Reliability principles
Mock-everywhere; graceful degradation (missing devices only flip a badge); no fake data in the UI; all tunables in `config.py`.

### 6.5 Voice fix (notable)
pyttsx3's SAPI driver uses COM events + a message pump that "succeed" silently in a server process. Fix: synthesize to a temp WAV via `win32com` SAPI `SpFileStream`, then play with `winsound.PlaySound` (`actuators/sapi.py`). Verified audible; pyttsx3 remains a fallback.

### 6.6 Testing & quality
55 backend tests pass (flat→no alert, ramp→drift, spike→no alert, recovery→hysteresis exit; actions; lux); `tsc`, `oxlint`, `vite build` clean.

### 6.7 Strengths
Genuine AIoT (fusion, personalization, temporal reasoning, closed actuation loop); explainability; graceful degradation; clean layering.

### 6.8 Gaps / roadmap
ESP32 `.ino` not written yet; token in `localStorage`; no login rate-limiting; WS auth via query-string token; real hardware path not CI-testable (covered by mocks).

### 6.9 Run
- Everything (Windows): `.\scripts\run_dev.bat`
- Backend: `backend\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000`
- Frontend: `frontend` → `npm run dev` → http://localhost:5173
- Tests: `backend\.venv\Scripts\python -m pytest -q`

**One line:** *ErgoSense is an AIoT smart-workstation — IoT sensors stream the physical world into an AI pipeline that learns your personal normal, detects gradual posture drift, produces an explainable Ergo Score, and closes the loop by adjusting your screen and speaking to you.*
