# M6: Sessions + History Pages + Demo Mode + README

**Tool: Cursor**

## Paste this prompt
> Read CLAUDE.md and CONTEXT.md. Then implement docs/modules/M6-sessions-history-demo.md. Do not change the scoring brain. Show a short plan first. Update CONTEXT.md at the end.

## Goal
Finish the product: session and history pages, a one-click demo mode for your presentation, tests and docs.

## Build
1. **`/sessions`**: current session card (live timer, since-last-break, "next break suggested in X min"), a "Take a break" button with a gentle break timer, a table of past sessions (start, end, duration, avg score as a coloured chip, breaks), and charts for work vs break time per day and average score per session. Add `GET /api/sessions/stats` (today / 7 days totals).
2. **`/history`**: range selector (1h, today, 7d, 30d) and metric toggles with a multi-line chart. Summary tiles (average score, best/worst day, % time in good posture, number of drift episodes) from `GET /api/history/summary`. A score-by-hour heatmap. A filterable, paginated events table. `GET /api/history/export.csv` plus an Export button. One rule-based weekly insight card.
3. **Demo mode:** a clearly labelled panel (top bar or Settings) with a Mock/Real switch, a "Simulate posture drift" button and a "Mock lux" slider, so the full story can be shown without hardware.
4. Polish: loading, empty and offline states on every page; a banner when the WebSocket is reconnecting; rate-limit login attempts.
5. **README.md:** architecture diagram, setup for Python + Node, ESP32 wiring (VCC→3.3V, GND→GND, SDA→GPIO21, SCL→GPIO22), how to calibrate, a step-by-step demo script, known limitations (distance is relative not absolute, single-camera pose limits, brightness control depends on OS/hardware).
6. A one-command run script for the whole app and a backend + frontend smoke test.

## Acceptance
- [ ] Fresh clone + README steps runs the app. Full flow works in mock mode: register → calibrate → monitor → simulate drift → alert → history.
- [ ] History charts come from stored DB data; empty ranges show an empty state; CSV downloads real rows.
- [ ] All tests pass.

## Commit
`git add . && git commit -m "M6: sessions, history, demo mode, docs" && git push`
