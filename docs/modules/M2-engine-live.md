# M2: Monitoring Engine + Live Stream

**Tool: Claude Code**

## Paste this prompt
> Read CLAUDE.md and CONTEXT.md. Then implement docs/modules/M2-engine-live.md. Reuse and fix sensor code from reference/qwen_old/ where it is good, but rewrite anything broken. First show me a short plan and wait for my OK. Then build, run, and tell me how to test. Update CONTEXT.md at the end.

## Goal
The sensor pipeline runs as a background service, controlled from the API, streaming live data to the browser. It must work with **no hardware** in mock mode.

## Build
1. `engine/runtime.py`: orchestrator with threads: webcam loop (~10 FPS), light reader, decision loop (1 Hz). Thread-safe shared state. Clean start/stop (release camera, close serial).
2. `engine/sensors/mock.py`: synthetic posture + lux generator **with a "simulate drift" switch** that slowly worsens posture so demos are reproducible. A way to set mock lux manually.
3. `engine/sensors/webcam.py`: MediaPipe Pose features: neck/forward-lean angle, shoulder tilt, head-forward ratio, relative distance proxy, movement, presence. Visibility gating + smoothing. Invalid frames are skipped, not scored.
4. `engine/sensors/light.py`: pyserial reader for `LUX:xxx` lines, auto-detect COM port, reconnect on disconnect, fall back to mock.
5. `firmware/bh1750_reader/bh1750_reader.ino` (reads BH1750 every 500 ms, prints `LUX:312.5`).
6. Endpoints: `POST /api/monitor/start`, `POST /api/monitor/stop`, `GET /api/monitor/status`, `GET /api/live`, `POST /api/monitor/mock` (toggle drift simulation, set mock lux).
7. `WS /ws/live?token=<jwt>`: pushes the snapshot (shape in CLAUDE.md) every second. Authenticate with the JWT.
8. Persist a `Sample` row every ~5 s while monitoring, tied to `user_id`.
9. Frontend: `hooks/useLive.ts` (opens the WebSocket, auto-reconnects, returns `{data, connected}`) and a temporary `/debug` page printing the live JSON with Start/Stop buttons.
10. For now `score`, `factors`, `drift`, `insight` may be simple placeholders computed from raw features. M3 replaces them with the real brain. Mark clearly in code where.

## Acceptance
- [ ] With `ERGOSENSE_MOCK=1`: Start → JSON on `/debug` updates every second. Stop halts it.
- [ ] "Simulate drift" visibly changes the posture numbers over time.
- [ ] Real mode: webcam light turns on at Start and **off** at Stop.
- [ ] Unplugging the ESP32 or blocking the camera never crashes the backend. `devices` shows the correct status.
- [ ] Samples are being written to the DB (check with the SQLite Viewer extension).
- [ ] Tests cover mock generator and snapshot shape.

## Commit
`git add . && git commit -m "M2: engine + live stream" && git push`
