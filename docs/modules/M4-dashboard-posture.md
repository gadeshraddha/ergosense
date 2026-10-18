# M4: Dashboard + Posture Pages

**Tool: Cursor** (the API and live data already exist, so this is UI wiring)

## Paste this prompt (in Cursor Agent/Composer)
> Read CLAUDE.md and CONTEXT.md. Then implement docs/modules/M4-dashboard-posture.md. Do not change the engine or auth. Only add the small endpoints this module lists plus the frontend pages. Show a short plan first. No fake data, everything from the API or the WebSocket. Update CONTEXT.md at the end.

## Goal
Open the app and understand your state in 5 seconds, plus a deep-dive posture page.

## Build
**Shared pieces:** `LiveContext` (wrap `useLive()` so every page shares one WebSocket), top-bar Start/Stop button and device-status dots wired to the live `devices` values, reusable `ScoreGauge`, `StatCard`, `StatusBadge`, `EmptyState`, `Skeleton`.

**Backend (small):**
- `GET /api/history?range=1h|today|7d&metrics=score,posture,screen,lighting,movement` returns downsampled series from stored samples.
- `GET /api/posture/summary` returns current features vs baseline with deviation per feature.
- `GET /api/posture/trend?range=` returns each feature's value and z-score over time.
- `GET /api/history/events?limit=` returns recent events.

**Dashboard `/dashboard`** (all real data):
1. Large Ergo Score gauge with a label (Excellent / Good / Needs attention / Poor), colour-coded.
2. Four factor cards: Posture, Screen Position, Lighting, Movement, each with a value, a mini bar and a status colour.
3. **AI Insight card**: the live `insight` text and current drift level.
4. Session card: work timer, time since last break.
5. Mini score trend for the last 30 minutes.
6. Recent activity (last 5 events).
7. Not-monitoring and not-calibrated states with clear call-to-action buttons.

**Posture `/posture`:**
1. Live cards for neck/forward-lean angle, shoulder tilt, head-forward ratio and distance, each showing current vs baseline ± band, a deviation arrow and a status. Label distance as "Relative estimate".
2. A simple SVG side-profile figure whose head offset follows the live lean value.
3. Drift timeline chart (z-score over time with the threshold lines drawn).
4. Today's breakdown: % of time good / mild / poor.
5. A rule-based tip card that changes with the current problem.

## Acceptance
- [ ] Numbers update live every second with no reload.
- [ ] "Simulate drift" visibly changes the gauge colour, insight text and the SVG figure.
- [ ] Changing the history range refetches real stored data. No `Math.random` anywhere.
- [ ] Empty/loading/offline states exist on both pages.

## Commit
`git add . && git commit -m "M4: dashboard and posture pages" && git push`
