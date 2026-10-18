# ErgoSense: Project Rules (read this at the start of every session)

You are a senior full-stack engineer building **ErgoSense**, a real, working, multi-page web app. Not a demo, not a project showcase.

## What ErgoSense is
An AIoT smart-workstation assistant. It watches the user's **posture** (laptop webcam + MediaPipe Pose) and **ambient light** (ESP32 + BH1750 over USB serial), learns a **personal baseline**, detects **gradual posture drift**, fuses everything into an **Ergo Score (0-100)**, **explains why** the score changed, and acts automatically: **auto screen brightness** and **voice feedback** through the laptop speaker. It also tracks **work sessions and breaks**.

Core loop: Sense → Learn baseline → Detect drift → Fuse → Score → Explain → Act → Re-evaluate

## How we work (IMPORTANT)
1. Read `CONTEXT.md` first. It says what is already built and what is next.
2. Work ONLY on the module the user names (files in `docs/modules/`). Do not build other modules' features.
3. Before writing code, show a SHORT plan: the files you will create/change. Wait for the user's OK.
4. Build the module fully: no `TODO`, no stubs, no "left as an exercise".
5. Run it yourself where you can (start the server, run tests) and fix errors before reporting done.
6. At the end: (a) list what you built, (b) give exact commands to run and test it, (c) tick the module in `CONTEXT.md` and note any decisions or known issues there.
7. The user is a first-time builder. Explain commands in one plain line each. Never assume they know what a flag or file does.
8. Never commit secrets. `.env` is git-ignored; keep `.env.example` updated.

## Non-negotiable rules
- **NO fake data in the UI.** No `Math.random()`, no hardcoded scores or placeholder arrays pretending to be live. Every number comes from the API/WebSocket. No data yet → show a proper empty state.
- **Every page is wired to a real endpoint** before its module counts as done.
- **Mock mode everywhere.** The whole app must run with no ESP32 and no webcam (synthetic posture + lux), controlled by `ERGOSENSE_MOCK=1`.
- **Graceful degradation.** ESP32 unplugged, camera busy, or brightness control unsupported must never crash anything. Show a status badge.
- **Per-user data.** Every record has a `user_id`; users never see each other's data.
- **Typed + validated.** Pydantic on every endpoint, TypeScript types on the frontend.
- **All tunable numbers live in `backend/app/config.py`.** No magic numbers scattered around.
- Keep the intent of the AI pipeline: personal baseline → z-score deviation → drift (slope + sustained offset + hysteresis) → weighted fusion with interaction rules → explanation templates.

## Fixed stack (do not change)
| Layer | Choice |
|---|---|
| Backend | Python 3.11/3.12, FastAPI, Uvicorn |
| Auth | JWT access token + bcrypt |
| DB | SQLite via SQLAlchemy |
| Realtime | WebSocket `/ws/live` (live data), REST for the rest |
| Posture | OpenCV + MediaPipe Pose |
| Light | pyserial reading ESP32 lines like `LUX:312.5`, with mock mode |
| Voice | pyttsx3 (offline) |
| Brightness | screen_brightness_control, graceful fallback |
| Frontend | React + Vite + TypeScript + Tailwind CSS + React Router + Recharts |

## Folder structure
```text
backend/
  app/
    main.py  config.py  database.py  models.py  schemas.py  security.py
    routers/   auth.py monitor.py calibration.py posture.py lighting.py
               sessions.py history.py alerts.py settings.py ws.py
    engine/    runtime.py
      sensors/ webcam.py light.py mock.py
      core/    baseline.py drift.py fusion.py scoring.py explain.py session.py
      actuators/ brightness.py voice.py
  tests/
  requirements.txt
frontend/
  src/ api/  auth/  hooks/useLive.ts  components/  pages/
firmware/bh1750_reader/bh1750_reader.ino
reference/qwen_old/      # earlier attempt: reuse its engine logic, never its UI
docs/modules/            # the 6 module specs
scripts/                 # run_dev scripts
CONTEXT.md  CLAUDE.md  README.md
```

## Live snapshot shape (the frontend depends on this exactly)
```json
{
  "ts": "ISO-8601", "monitoring": true, "mode": "mock|real", "calibrated": true, "present": true,
  "features": {"neck_angle": 0, "shoulder_tilt": 0, "head_forward": 0, "distance_proxy": 0, "movement": 0},
  "lux": 0,
  "factors": {"posture": 0, "screen": 0, "lighting": 0, "movement": 0},
  "score": 0,
  "drift": {"level": "none|mild|significant", "feature": "", "minutes": 0},
  "insight": "human readable explanation",
  "session": {"minutes": 0, "since_break_minutes": 0, "state": "active|break"},
  "devices": {"camera": "ok|error|off", "esp32": "ok|mock|disconnected", "brightness": "ok|unsupported", "voice": "ok|muted"}
}
```

## UI direction
Clean, modern health-tech product. Dark mode + light mode toggle. Left sidebar, top bar with monitoring status. Rounded cards, one accent colour, green/amber/red status colours, generous spacing, responsive. It should look like a real SaaS dashboard.
