# ErgoSense — One-Page Report

**What it is.** ErgoSense is an AIoT smart-workstation assistant. It watches your **posture** (laptop webcam + MediaPipe) and your **room light** (ESP32 + BH1750), learns your **personal baseline**, detects **gradual posture drift**, fuses everything into an explainable **Ergo Score (0–100)**, and acts automatically — **auto screen brightness** and **voice feedback**. It also tracks work sessions and breaks.

**Core loop:** Sense → Learn baseline → Detect drift → Fuse → Score → Explain → Act → Re-evaluate

---

## Stack (what we used, where)

| Layer | Technology | Files |
|---|---|---|
| Frontend | React + TypeScript + Vite + Tailwind + Recharts | `frontend/src/pages`, `hooks`, `components` |
| Backend | Python + FastAPI + Uvicorn | `backend/app/main.py`, `routers/`, `engine/` |
| Database | SQLite via SQLAlchemy | `backend/app/models.py`, `database.py` |
| Auth | JWT + bcrypt | `backend/app/security.py` |
| Realtime | WebSocket `/ws/live` | `backend/app/routers/ws.py`, `frontend/src/hooks/useLive.ts` |
| Vision | MediaPipe Pose (in-browser) | `frontend/src/hooks/usePostureTracking.ts` |
| Sensors | pyserial (ESP32), webcam lux | `backend/app/engine/sensors/` |
| Actuators | screen-brightness-control, SAPI→WAV→winsound | `backend/app/engine/actuators/` |
| Tunables | all numbers centralized | `backend/app/config.py` |

---

## How it works (short flow)

1. **Sense** — mock sensors or real webcam/ESP32 produce 5 posture features + lux.
2. **Learn baseline** — calibration builds *your* normal (mean/std per feature); gently updated via EMA when you're doing well.
3. **Detect drift** — rolling-window slope + sustained-offset test with hysteresis → `{level, feature, minutes}`.
4. **Score** — four factors 0–100 (posture, screen, lighting, movement), fused with weights (.35/.25/.20/.20) and smoothed ~30 s.
5. **Explain** — names the factor that fell most in a plain sentence.
6. **Act** — auto-brightness (lux→% with deadband/rate-limit) + voice prompts (welcome, drift, dim room, long session).
7. **Re-evaluate** — writes samples/events, saves the learned baseline.

---

## How it uses IoT

IoT = **physical devices that sense the real world, connected to software that acts on it.**

- **Sensors (things):** ESP32 + BH1750 streams `LUX:312.5` over USB serial (`sensors/light.py`); the webcam is a second sensor (vision + ambient lux).
- **Connectivity:** USB serial (device→backend) + WebSocket (backend→browser).
- **Actuators (things):** the laptop screen (brightness) and speaker (voice).
- **Closed loop example:** room dims → lux = 180 → `lux_to_target` computes ~20% → `set_brightness(20)` → your screen actually dims. World → sensor → software → world, no human needed.
- **Example:** lux < 250 → both an automatic action (brightness) and a spoken nudge ("the room is quite dim").
- **IoT-ready without hardware:** mock mode runs the whole system with no devices; switching to real mode plugs them in (and clears synthetic data).

---

## How we incorporated AI with IoT (AIoT)

AIoT = devices that don't just measure, but **learn and decide.**

| AI technique | What it does | File |
|---|---|---|
| Personal baseline (unsupervised) | Learns *your* normal from your data | `core/baseline.py` |
| z-score deviation | "How unusual is this vs you?" anomaly detection | `baseline.py:FeatureStat.z` |
| Drift detection | Least-squares slope + sustained offset + hysteresis (temporal reasoning) | `core/drift.py` |
| Sensor fusion | Combines camera + light into one score, smoothed | `core/fusion.py`, `scoring.py` |
| Explainable reasoning | Picks the worst factor, writes why + what it will do | `core/explain.py`, `decide.py` |
| Online learning | Baseline adapts to your current normal (EMA) | `baseline.py:ema_update` |
| On-edge deep learning | MediaPipe Pose turns pixels → body landmarks in-browser | `usePostureTracking.ts` |

**The AI↔IoT loop:** webcam + BH1750 sense → z-scores vs *your* baseline → drift slope spots a gradual slump → camera + light fuse into the Ergo Score → the system explains the cause → screen brightness and voice react → baseline adapts as you stay healthy. A full **perception → cognition → action** loop.

---

## Reliability & quality

- **No fake data in the UI** — every number comes from the API/WebSocket; empty states elsewhere.
- **Mock everywhere + graceful degradation** — missing camera/ESP32/brightness/TTS only flips a device badge, never crashes.
- **Per-user isolation** — every record carries `user_id`.
- **Typed + validated** — Pydantic on every endpoint, TypeScript on the frontend.
- **Tests:** 55 backend tests pass; `tsc`, `oxlint`, `vite build` clean.

---

## Run it

- Everything (Windows): `.\scripts\run_dev.bat`
- Backend: `backend\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000`
- Frontend: `frontend` → `npm run dev` → http://localhost:5173
- Tests: `backend\.venv\Scripts\python -m pytest -q`

---

## Known gaps

- ESP32 firmware sketch (`bh1750_reader.ino`) still to be written — backend is ready to consume it.
- Token in `localStorage`; no login rate-limiting yet.
- WebSocket auth via query-string token (fine locally; cookies would be hardened).

**One line:** *ErgoSense is an AIoT smart-workstation — IoT sensors stream the physical world into an AI pipeline that learns your personal normal, detects gradual posture drift, produces an explainable Ergo Score, and closes the loop by adjusting your screen and speaking to you.*
