# M3: Calibration + AI Brain + Sessions

**Tool: Claude Code**. This is the heart of the project. If it feels too big, tell Claude: "Split this into M3a (backend brain) and M3b (calibration page + sessions), do M3a first."

## Paste this prompt
> Read CLAUDE.md and CONTEXT.md. Then implement docs/modules/M3-calibration-brain.md. Reuse the good ideas from reference/qwen_old/ (baseline, drift, fusion, explain) but make the logic correct and tested. First show me a short plan and wait for my OK. Update CONTEXT.md at the end.

## Goal
The app learns each user's normal posture, detects gradual drift, produces the Ergo Score, explains it, and tracks work sessions.

## Build
**Calibration**
1. Endpoints: `POST /api/calibration/start` (default 150 s, configurable), `GET /api/calibration/status` (progress %, valid samples, quality), `POST /api/calibration/cancel`, `GET /api/calibration/baseline`, `DELETE /api/calibration/baseline`.
2. Use valid samples only. Compute mean + std (median/MAD if outliers). Reject a bad calibration (too few valid samples, too much movement) **and say why**. Save as the user's active baseline.
3. Baseline auto-update: tiny EMA step, only during high-score periods with no alerts. Never learn bad posture.

**Intelligence core** (replaces the placeholders from M2)
4. Per-feature z-score vs baseline (clipped).
5. Drift detection: rolling window (config, default 10 min, plus a short "demo window" option), slope check + sustained-offset check, hysteresis (enter threshold > exit threshold). Output `{level, feature, minutes}`.
6. Factor scores 0-100: posture, screen position, lighting (lux vs a configurable comfort range), movement.
7. Fusion: weights from config (posture 0.35, screen 0.25, lighting 0.20, movement 0.20) **plus interaction rules** (forward lean + closer distance + long session → extra penalty). Smooth the score over ~30 s.
8. Explanation: find which factor contributed most to the drop vs the recent average and write 1-2 clear sentences, e.g. "Your score dropped mainly because your posture has gradually drifted from your personal baseline (forward lean +12° over 20 min)."
9. Write `Event` rows: DRIFT_START, DRIFT_END, LONG_SESSION, LOW_LIGHT, TOO_BRIGHT, BREAK_TAKEN, LOW_MOVEMENT.

**Sessions**
10. A `WorkSession` starts when monitoring starts, ends when it stops. Continuous work time resets after a real break (absent ≥ config minutes, or manual). Endpoints: `GET /api/sessions`, `GET /api/sessions/current`, `POST /api/sessions/break`.

**Frontend**
11. `/calibration` wizard page: (1) readiness checks (camera, ESP32 or mock), (2) "Sit the way you normally work" with a countdown ring + live valid-sample count, (3) result summary with Accept / Redo. If a baseline exists, show it and a Recalibrate button.
12. The `/debug` page now shows the real brain output.

## Acceptance
- [ ] A new user can calibrate via the wizard; baseline survives a server restart; a bad calibration is rejected with a reason.
- [ ] In mock "simulate drift" mode the score falls over a few minutes, `drift.level` escalates, `insight` names the right factor, and events appear in the DB.
- [ ] Unit tests with synthetic data: flat → no alert; slow ramp → drift flagged; spike → no alert; recovery → hysteresis exit. All pass.
- [ ] Session list works after a restart.

## Commit
`git add . && git commit -m "M3: calibration, brain, sessions" && git push`
