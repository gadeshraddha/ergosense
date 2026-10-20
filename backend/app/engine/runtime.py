"""The per-user monitoring runtime: the living Sense -> ... -> Re-evaluate loop.

One background thread per active user runs the decision loop at ~1 Hz:
sensors -> baseline EMA -> drift -> fuse -> score -> explain -> act -> events.
A WebSocket (and ``GET /api/monitor/live``) simply read :meth:`UserRuntime.snapshot`,
which is updated under a lock, so there is no cross-thread asyncio plumbing.

Everything degrades gracefully: no camera, no ESP32, no brightness control and
no text-to-speech must never crash the loop — they only flip a device badge.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone

from ..config import settings
from ..database import SessionLocal
from ..models import Baseline, Event, Sample, UserSetting, WorkSession
from .actuators.brightness import BrightnessController, lux_to_target
from .actuators.voice import VoiceEngine
from .core import decide as decidemod
from .core import drift as dcore
from .core import explain as exp
from .core import fusion as fcore
from .core import scoring as score
from .core.baseline import ema_update, stats_from_json
from .sensors.light import LightReader
from .sensors.mock import MockSensors
from .sensors.webcam import WebcamSource

log = logging.getLogger("ergosense.runtime")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserRuntime:
    def __init__(self, user_id: int) -> None:
        self.user_id = user_id
        self._lock = threading.Lock()
        self.monitoring = False
        self.mode = "mock" if settings.mock else "real"
        self.calibrated = False
        self.present = False
        self.features: dict = {}
        self.lux: float | None = None
        self.factors = {"posture": 100.0, "screen": 100.0, "lighting": 100.0, "movement": 100.0}
        self.score = 100.0
        self.drift = {"level": "none", "feature": "", "minutes": 0.0}
        self.insight = "Start monitoring to see your live Ergo Score."
        self.session = {"minutes": 0.0, "since_break_minutes": 0.0, "state": "active"}
        self.devices = {"camera": "off", "esp32": "off", "brightness": "ok", "voice": "ok"}

        self._score_history: deque[float] = deque(maxlen=600)
        self._score_sum = 0.0
        self._score_n = 0
        self._factor_recent: dict[str, deque[float]] = {
            k: deque(maxlen=300) for k in ("posture", "screen", "lighting", "movement")
        }
        self._started_at: datetime | None = None
        self._last_active: datetime = utcnow()
        self._stats: dict = {}
        self._drift_level_prev = "none"
        self._last_written = utcnow() - timedelta(seconds=settings.sample_write_seconds + 1)
        self._last_baseline_save = time.monotonic()
        self._baseline_dirty = False
        # Ambient light estimated by the browser webcam (used when no ESP32 is
        # actually connected, so real mode still has a live light signal).
        self._browser_lux: float | None = None
        self._browser_lux_ts: float = 0.0
        # One-shot greeting spoken right after a session starts.
        self._welcome_pending = False

        # sensors / actuators
        self._mock = MockSensors(lux=settings.mock_lux, simulate_drift=settings.mock_drift)
        self._webcam = WebcamSource()
        self._light: LightReader | None = None if self.mode == "mock" else LightReader(settings.mock_lux)
        self.brightness = BrightnessController(
            min_pct=settings.brightness_min_pct,
            max_pct=settings.brightness_max_pct,
            deadband_pct=settings.brightness_deadband_pct,
            min_interval_s=settings.brightness_min_interval_s,
            auto_pause_minutes=settings.brightness_auto_pause_minutes,
        )
        self.voice = VoiceEngine(
            enabled=settings.voice_enabled,
            volume=settings.voice_volume,
            rate=settings.voice_rate,
            cooldown_seconds=settings.voice_cooldown_seconds,
            repeat_seconds=settings.voice_repeat_seconds,
        )
        self.prefs = {
            "voice_enabled": settings.voice_enabled,
            "brightness_mode": "auto",
            "manual_brightness": None,
        }
        self._det = dcore.DriftDetector(
            feature="neck_angle",
            window_minutes=settings.drift_demo_window_minutes
            if settings.mock
            else settings.drift_window_minutes,
            enter_threshold=settings.drift_enter_threshold,
            exit_threshold=settings.drift_exit_threshold,
            enter_minutes=settings.drift_enter_minutes,
            significant_multiplier=settings.drift_significant_multiplier,
        )
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    # -- lifecycle ---------------------------------------------------------
    def start(self) -> None:
        if self.monitoring:
            return
        now = utcnow()
        self.monitoring = True
        self._started_at = now
        self._last_active = now
        self._det.reset()
        self._score_history.clear()
        self._score_sum = 0.0
        self._score_n = 0
        with SessionLocal() as db:
            self._load_baseline(db)
            self._load_prefs(db)
            db.add(WorkSession(user_id=self.user_id, start=now))
            db.commit()
        if self._light:
            self._light.start()
        self.voice.start()
        self._welcome_pending = True
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name=f"ergosense-rt-{self.user_id}", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.monitoring = False
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)
        self._thread = None
        if self._light:
            self._light.stop()
        self.voice.stop()
        with SessionLocal() as db:
            ws = (
                db.query(WorkSession)
                .filter(WorkSession.user_id == self.user_id, WorkSession.end.is_(None))
                .order_by(WorkSession.id.desc())
                .first()
            )
            if ws:
                ws.end = utcnow()
                if self._score_n:
                    ws.avg_score = round(self._score_sum / self._score_n, 1)
                db.commit()

    # -- external inputs ---------------------------------------------------
    def feed(self, features: dict, lux: float | None = None) -> None:
        """Push a browser-posted posture frame (real-mode webcam source)."""
        self._webcam.update(features)
        if lux is not None:
            with self._lock:
                self.lux = float(lux)
                self._browser_lux = float(lux)
                self._browser_lux_ts = time.monotonic()

    def set_mock(self, *, lux: float | None = None, drift: bool | None = None) -> None:
        if lux is not None:
            self._mock.set_lux(lux)
        if drift is not None:
            self._mock.set_drift(drift)

    def set_mode(self, mode: str) -> bool:
        """Switch between the simulated sensors (mock) and the real hardware.

        Safe to call while monitoring: the light reader is rebuilt and the drift
        detector window is retuned (mock drifts are deliberately faster).
        Returns True when the mode actually changed.
        """
        if mode not in ("mock", "real"):
            return False
        with self._lock:
            changed = self.mode != mode
            self.mode = mode
            if changed and mode == "real":
                # never carry synthetic features into a real session
                self.features = {}
                self.present = False
        if not changed:
            return False
        if self._light:
            self._light.stop()
            self._light = None
        if mode == "real":
            self._light = LightReader(settings.mock_lux)
            if self.monitoring:
                self._light.start()
        self._det = dcore.DriftDetector(
            feature="neck_angle",
            window_minutes=settings.drift_demo_window_minutes
            if mode == "mock"
            else settings.drift_window_minutes,
            enter_threshold=settings.drift_enter_threshold,
            exit_threshold=settings.drift_exit_threshold,
            enter_minutes=settings.drift_enter_minutes,
            significant_multiplier=settings.drift_significant_multiplier,
        )
        self._det.reset()
        self._drift_level_prev = "none"
        return True

    def mark_break(self) -> None:
        """A break was just taken: restart the time-since-break clock."""
        self._last_active = utcnow()

    def welcome(self) -> bool:
        """Speak the one-shot greeting at session start (bypasses cooldowns).

        Returns True if the greeting was accepted for speaking. If voice is
        unavailable or muted this is a quiet no-op.
        """
        if not settings.voice_welcome_text:
            return False
        spoke = self.voice.speak(settings.voice_welcome_text, force=True)
        self._welcome_pending = False
        if spoke:
            self._write_event(utcnow(), "voice", "info", settings.voice_welcome_text, "welcome")
        return spoke

    def _prefer_browser_lux(
        self, lux: float | None, status: str, *, max_age_s: float = 10.0
    ) -> tuple[float | None, str]:
        """Use the webcam's ambient-light estimate unless a real ESP32 is present.

        The ESP32 reader reports ``mock``/``disconnected`` when no hardware is
        attached, in which case a fresh browser lux reading is the better signal.
        Returns the chosen ``(lux, device_status)``.
        """
        if status == "ok":
            return lux, status
        if self._browser_lux is not None and (time.monotonic() - self._browser_lux_ts) <= max_age_s:
            return self._browser_lux, "webcam"
        return lux, status

    # -- snapshot ----------------------------------------------------------
    def snapshot(self) -> dict:
        with self._lock:
            return {
                "ts": utcnow(),
                "monitoring": self.monitoring,
                "mode": self.mode,
                "calibrated": self.calibrated,
                "present": self.present,
                "features": dict(self.features),
                "lux": self.lux,
                "factors": dict(self.factors),
                "score": round(self.score, 1),
                "drift": dict(self.drift),
                "insight": self.insight,
                "session": dict(self.session),
                "devices": dict(self.devices),
            }

    # -- the loop ----------------------------------------------------------
    def _loop(self) -> None:
        tick = max(0.2, settings.runtime_tick_seconds)
        while not self._stop.is_set():
            try:
                self._tick()
            except Exception:  # never let the loop die
                log.exception("runtime tick failed for user %s", self.user_id)
            self._stop.wait(tick)

    def _tick(self) -> None:
        now = utcnow()
        # --- Sense ---
        if self.mode == "mock":
            features, lux = self._mock.read()
            cam_status, esp_status = "mock", "mock"
        else:
            features, cam_status = self._webcam.read()
            lux, esp_status = (self._light.read() if self._light else (None, "disconnected"))
            # No real ESP32 present -> the reader falls back to a constant mock
            # value. Prefer the browser's webcam estimate so real mode still has
            # a *live* ambient-light signal (a phone-style light sensor).
            lux, esp_status = self._prefer_browser_lux(lux, esp_status)

        with SessionLocal() as db:
            self._load_baseline(db)
            self._load_prefs(db)

            fresh = features is not None
            if features is None:
                features = dict(self.features)  # hold last good frame so the score does not jump
            with self._lock:
                self.features = features
                self.lux = lux
                # present must mean "a frame arrived right now", not "we saw someone earlier"
                self.present = fresh
                self.devices = {
                    "camera": cam_status,
                    "esp32": esp_status,
                    "brightness": self.brightness.status(),
                    "voice": self.voice.status(),
                }

            neck = float(features.get("neck_angle", 0.0) or 0.0)
            dist = float(features.get("distance_proxy", 0.0) or 0.0)
            mov = float(features.get("movement", 0.0) or 0.0)

            # --- session / break ---
            if self._started_at is not None:
                minutes = (now - self._started_at).total_seconds() / 60.0
                since_break = (now - self._last_active).total_seconds() / 60.0
                state = "break" if since_break >= settings.break_minutes else "active"
                with self._lock:
                    self.session = {
                        "minutes": round(minutes, 1),
                        "since_break_minutes": round(since_break, 1),
                        "state": state,
                    }

            # --- Learn baseline (EMA, only when comfortable) ---
            if self._stats and self.score >= settings.baseline_learn_min_score and self.drift["level"] == "none":
                for name, value in (("neck_angle", neck), ("distance_proxy", dist)):
                    if name in self._stats:
                        ema_update(self._stats[name], value, settings.baseline_ema_alpha)
                self._baseline_dirty = True

            # --- Detect drift ---
            minutes = 0.0
            if self._started_at is not None:
                minutes = (now - self._started_at).total_seconds() / 60.0
            if "neck_angle" in self._stats:
                self._det.add(minutes, neck, self._stats["neck_angle"].mean)
            d = self._det.evaluate(minutes)
            with self._lock:
                self.drift = {"level": d.level, "feature": d.feature, "minutes": round(d.minutes, 1)}

            # --- Fuse + score ---
            ps = score.score_posture(neck, self._stats.get("neck_angle"), settings.posture_z_penalty)
            ss = score.score_screen(dist, self._stats.get("distance_proxy"), settings.screen_z_penalty)
            ls = score.score_lighting(lux, settings.lux_comfort_min, settings.lux_comfort_max)
            ms = score.score_movement(mov, settings.movement_min)
            factors = fcore.FactorScores(posture=ps, screen=ss, lighting=ls, movement=ms)
            raw = factors.weighted_sum(
                {
                    "posture": settings.weight_posture,
                    "screen": settings.weight_screen,
                    "lighting": settings.weight_lighting,
                    "movement": settings.weight_movement,
                }
            )
            target = fcore.clamp(raw)
            with self._lock:
                self.score = fcore.smooth_score(self.score, target, settings.score_smoothing_seconds)
                self.factors = {"posture": ps, "screen": ss, "lighting": ls, "movement": ms}
                self._score_history.append(self.score)
                self._score_sum += float(self.score)
                self._score_n += 1
                for k, v in (("posture", ps), ("screen", ss), ("lighting", ls), ("movement", ms)):
                    self._factor_recent[k].append(v)

            # --- Explain ---
            with self._lock:
                insight = exp.explain_change(
                    score_now=self.score,
                    score_prev=self._previous_score_avg(),
                    factors_now=self.factors,
                    factors_recent_avg={k: self._avg(v) for k, v in self._factor_recent.items()},
                    drift=self.drift,
                    baseline_present=self.calibrated,
                )
                self.insight = insight

            # --- Act ---
            self._act(now, lux)

            # --- Re-evaluate / persist ---
            if self.present:
                # never write a "reading" for a moment when nobody is in view
                self._persist_sample(now, features, lux)
            self._persist_baseline_if_due(db)

    # -- acting ------------------------------------------------------------
    def _act(self, now: datetime, lux: float | None) -> None:
        # Auto-brightness (real actuators only; still compute a target in mock).
        if self.prefs.get("brightness_mode", "auto") == "auto" and lux is not None:
            target = lux_to_target(
                lux,
                comfort_min=settings.lux_comfort_min,
                comfort_max=settings.lux_comfort_max,
                min_pct=settings.brightness_min_pct,
                max_pct=settings.brightness_max_pct,
                dark_factor=settings.brightness_dark_factor,
            )
            self.brightness.apply(target, manual=False)

        state = {
            "drift": self.drift,
            "session": self.session,
            "lux": lux,
            "welcome": settings.voice_welcome_text if self._welcome_pending else None,
            "low_light_lux": settings.low_light_lux,
            "long_session_minutes": settings.long_session_minutes
            if settings.long_session_prompt
            else None,
            "long_session_prompt": settings.long_session_prompt,
        }
        for action in decidemod.decide_actions(state):
            if action.kind != "speak":
                continue
            if self.voice.speak(action.message):
                self._write_event(now, "voice", "info", action.message, action.reason)
                if action.reason == "welcome":
                    self._welcome_pending = False

        # Log drift transitions as events too.
        level = self.drift["level"]
        if level != self._drift_level_prev and level != "none":
            msg = f"Posture drift detected ({level})"
            self._write_event(now, "drift", "warning" if level == "significant" else "info", msg, f"drift_{level}")
        self._drift_level_prev = level

    # -- persistence helpers ----------------------------------------------
    def _persist_sample(self, now: datetime, features: dict, lux: float | None) -> None:
        if (now - self._last_written).total_seconds() < settings.sample_write_seconds:
            return
        with SessionLocal() as db:
            db.add(
                Sample(
                    user_id=self.user_id,
                    ts=now,
                    neck_angle=features.get("neck_angle"),
                    shoulder_tilt=features.get("shoulder_tilt"),
                    head_forward=features.get("head_forward"),
                    distance_proxy=features.get("distance_proxy"),
                    movement=features.get("movement"),
                    lux=lux,
                    score=float(self.score),
                )
            )
            db.commit()
        self._last_written = now

    def _persist_baseline_if_due(self, db) -> None:
        if not self._baseline_dirty:
            return
        if time.monotonic() - self._last_baseline_save < settings.baseline_persist_seconds:
            return
        base = (
            db.query(Baseline)
            .filter(Baseline.user_id == self.user_id, Baseline.is_active)
            .order_by(Baseline.id.desc())
            .first()
        )
        if base:
            stats_json = dict(base.json_stats or {})
            stats_json["stats"] = {
                name: {
                    "mean": round(s.mean, 5),
                    "std": round(s.std, 5),
                    "median": round(s.median, 5),
                    "mad": round(s.mad, 5),
                    "n": s.n,
                }
                for name, s in self._stats.items()
            }
            base.json_stats = stats_json
            db.commit()
        self._baseline_dirty = False
        self._last_baseline_save = time.monotonic()

    def _write_event(self, now: datetime, etype: str, severity: str, message: str, reason: str = "") -> None:
        with SessionLocal() as db:
            db.add(
                Event(
                    user_id=self.user_id,
                    ts=now,
                    type=etype,
                    severity=severity,
                    message=message if not reason else f"{message} ({reason})",
                )
            )
            db.commit()

    # -- db helpers --------------------------------------------------------
    def _load_baseline(self, db) -> None:
        base = (
            db.query(Baseline)
            .filter(Baseline.user_id == self.user_id, Baseline.is_active)
            .order_by(Baseline.id.desc())
            .first()
        )
        self._stats = (
            stats_from_json(base.json_stats, std_floors=settings.baseline_std_floors)
            if base
            else {}
        )
        self.calibrated = base is not None

    def _load_prefs(self, db) -> None:
        rows = (
            db.query(UserSetting)
            .filter(UserSetting.user_id == self.user_id, UserSetting.key.in_(["voice_enabled", "brightness_mode", "manual_brightness"]))
            .all()
        )
        for r in rows:
            val = (r.value or {}).get("v")
            if r.key == "voice_enabled" and isinstance(val, bool):
                self.prefs["voice_enabled"] = val
                self.voice.set_enabled(val)
            elif r.key == "brightness_mode" and val in ("auto", "manual"):
                self.prefs["brightness_mode"] = val
            elif r.key == "manual_brightness" and isinstance(val, (int, float)):
                self.prefs["manual_brightness"] = float(val)

    @staticmethod
    def _avg(values) -> float:
        vals = list(values)
        return sum(vals) / len(vals) if vals else 100.0

    def _previous_score_avg(self) -> float:
        """Average of the score history *excluding* the newest value.

        ``self._score_history`` is a deque, which cannot be sliced directly, so
        we copy it to a list first.
        """
        prev = list(self._score_history)[:-1]
        return self._avg(prev) if prev else self.score


class RuntimeManager:
    """Process-wide registry of per-user runtimes."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._runtimes: dict[int, UserRuntime] = {}

    def ensure(self, user_id: int) -> UserRuntime:
        with self._lock:
            rt = self._runtimes.get(user_id)
            if rt is None:
                rt = UserRuntime(user_id)
                self._runtimes[user_id] = rt
            return rt

    def get(self, user_id: int) -> UserRuntime | None:
        with self._lock:
            return self._runtimes.get(user_id)

    def stop_all(self) -> None:
        with self._lock:
            runtimes = list(self._runtimes.values())
        for rt in runtimes:
            try:
                rt.stop()
            except Exception:
                log.exception("failed to stop runtime for user %s", rt.user_id)


manager = RuntimeManager()
