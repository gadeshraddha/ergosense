# M5: Auto-Brightness + Voice Feedback + Lighting and Alerts/Settings Pages

**Tool: Cursor.** The threading and OS parts are trickier. If Cursor gets stuck on `brightness.py` or `voice.py` twice, switch just that file to Claude Code.

## Paste this prompt
> Read CLAUDE.md and CONTEXT.md. Then implement docs/modules/M5-actions-lighting-alerts.md. Do not change auth, calibration or the scoring brain. Show a short plan first. Update CONTEXT.md at the end.

## Goal
The system acts on its own: screen brightness follows room light, and gentle voice prompts fire on sustained problems. The user can see and control both.

## Build
**Auto-brightness (`engine/actuators/brightness.py`)**
1. Map lux to target brightness % with a smooth log-like curve, clamped 20-100 %.
2. Rate-limit changes, add a deadband (ignore tiny lux changes) so the screen never flickers or hunts.
3. If the user changes brightness manually, pause auto for N minutes.
4. If brightness control is unsupported on this laptop, still compute and display the target, and set `devices.brightness = "unsupported"`. No crash.
5. Endpoints: `GET /api/lighting/summary` (lux, comfort zone, target %, current %, mode, supported), `POST /api/lighting/mode` (auto|manual), `POST /api/lighting/brightness` (manual %).

**Voice (`engine/actuators/voice.py`) + decision layer**
6. pyttsx3 in a worker queue so it never blocks. Message library per event type (lean, distance, long session, low light, break).
7. `decide(state) → actions[]`: speak only on **sustained** drift, never instant deviation. Same message not within ~10 min, global max one prompt per ~3 min, optional quiet hours. Log every spoken prompt as an `Event` with the reason.
8. Endpoints: `GET /api/alerts`, `POST /api/alerts/test-voice`, `POST /api/alerts/mute` (15/30/60 min), `GET/PUT /api/settings`.

**Pages**
9. **`/lighting`**: live lux dial with a comfort-zone band and status (Too dark / Comfortable / Too bright), a lux→brightness curve chart with a moving dot for the live point, Auto/Manual toggle with slider, a lux + brightness trend chart, and a device card (ESP32/BH1750 state, port, mock badge).
10. **`/alerts` (Alerts & Settings)**: timeline of every alert (time, type, message spoken, reason), filter by type, Test voice button, quick snooze. Settings tabs: Profile (name, change password), Monitoring (sensitivity low/med/high, comfort lux range, score weights as sliders that must total 100 %), Voice (on/off, volume, cooldowns, quiet hours), Danger zone (reset baseline, delete my data). Save with toast feedback and validation.

## Acceptance
- [ ] Changing room light (or the mock-lux slider) smoothly changes target brightness. Manual mode stops auto changes.
- [ ] Unsupported brightness shows a clear note, not an error.
- [ ] A prompt never repeats inside its cooldown. Mute really silences it.
- [ ] Changing a setting changes real behaviour (for example a lower session limit triggers an earlier break prompt).
- [ ] Settings persist across restart.

## Commit
`git add . && git commit -m "M5: actions, lighting, alerts and settings" && git push`
