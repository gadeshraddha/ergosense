"""Unit tests for M2/M5 engine pieces: brightness curve, decisions, sensors, voice."""
from __future__ import annotations

import time
from datetime import timedelta

import pytest

from app.engine.actuators.brightness import BrightnessController, lux_to_target
from app.engine.actuators.voice import VoiceEngine
from app.engine.core import decide
from app.engine.runtime import UserRuntime
from app.engine.sensors.mock import MockSensors
from app.engine.sensors.webcam import WebcamSource


# --- brightness curve -----------------------------------------------------
def test_lux_to_target_is_bounded():
    for lux in [None, 0, 5, 50, 300, 800, 5000, 100000]:
        pct = lux_to_target(
            lux, comfort_min=300, comfort_max=1000, min_pct=20, max_pct=100
        )
        assert 20 <= pct <= 100


def test_lux_to_target_rises_with_light():
    dark = lux_to_target(20, comfort_min=300, comfort_max=1000, min_pct=20, max_pct=100)
    mid = lux_to_target(600, comfort_min=300, comfort_max=1000, min_pct=20, max_pct=100)
    bright = lux_to_target(3000, comfort_min=300, comfort_max=1000, min_pct=20, max_pct=100)
    assert dark <= mid <= bright


def test_brightness_deadband_and_rate_limit():
    c = BrightnessController(deadband_pct=3.0, min_interval_s=5.0)
    _, changed = c.apply(50.0)
    assert changed is True  # first move always applies
    _, changed = c.apply(51.0)
    assert changed is False  # inside deadband
    _, changed = c.apply(90.0)
    assert changed is False  # rate-limited (too soon)


def test_manual_change_pauses_auto():
    c = BrightnessController(deadband_pct=0.0, min_interval_s=5.0, auto_pause_minutes=5.0)
    c.apply(40.0, manual=True)
    assert c.paused() is True
    _, changed = c.apply(95.0, manual=False)
    assert changed is False  # auto is paused


# --- decision layer -------------------------------------------------------
def test_decide_speaks_on_drift():
    actions = decide.decide_actions({"drift": {"level": "significant", "feature": "neck_angle"}})
    assert any(a.kind == "speak" and "posture" in a.message.lower() for a in actions)


def test_decide_speaks_on_low_light_and_long_session():
    actions = decide.decide_actions(
        {
            "drift": {"level": "none"},
            "lux": 120,
            "low_light_lux": 250,
            "session": {"since_break_minutes": 55},
            "long_session_minutes": 50,
            "long_session_prompt": True,
        }
    )
    reasons = {a.reason for a in actions}
    assert "low_light" in reasons
    assert "long_session" in reasons


def test_decide_quiet_when_fine():
    actions = decide.decide_actions(
        {
            "drift": {"level": "none"},
            "lux": 500,
            "low_light_lux": 250,
            "session": {"since_break_minutes": 5},
            "long_session_minutes": 50,
        }
    )
    assert actions == []


def test_decide_speaks_welcome_when_pending():
    actions = decide.decide_actions(
        {
            "drift": {"level": "none"},
            "lux": 500,
            "low_light_lux": 250,
            "session": {"since_break_minutes": 0},
            "welcome": "Welcome, I am Ergo.",
        }
    )
    assert len(actions) == 1
    assert actions[0].kind == "speak"
    assert actions[0].reason == "welcome"
    assert actions[0].message == "Welcome, I am Ergo."


# --- sensors --------------------------------------------------------------
def test_mock_sensors_shape_and_drift():
    s = MockSensors(simulate_drift=True, drift_rate=0.2, seed=1)
    s._start = time.monotonic() - 60  # pretend one minute has passed
    features, lux = s.read()
    assert set(features) == {
        "neck_angle",
        "shoulder_tilt",
        "head_forward",
        "distance_proxy",
        "movement",
    }
    assert features["neck_angle"] > 0.10  # drift raised it above the resting value
    assert lux == s.lux

    s.set_drift(False)
    s._start = time.monotonic() - 600
    features_off, _ = s.read()
    assert abs(features_off["neck_angle"] - 0.10) < 0.1


def test_webcam_source_stale():
    w = WebcamSource(stale_after_s=5.0)
    w.update({"neck_angle": 0.1, "distance_proxy": 0.25})
    w._ts = time.monotonic() - 10  # pretend the frame is 10s old
    features, status = w.read()
    assert features is None and status == "off"  # stale frame ignored



# --- voice gating ---------------------------------------------------------
def test_voice_gating_and_mute():
    v = VoiceEngine(enabled=True, cooldown_seconds=180, repeat_seconds=600)
    v._supported = True
    assert v.can_speak("hello") is True
    v.speak("hello")
    assert v.can_speak("hello") is False  # cooldown + repeat
    v._last_spoken = time.monotonic() - 1000
    assert v.can_speak("hello") is False  # still inside repeat window
    v._last_message_time = time.monotonic() - 1000
    assert v.can_speak("hello") is True
    v.mute(10)
    assert v.muted() is True
    assert v.can_speak("another") is False


def test_voice_speak_self_heals_from_init_failure(monkeypatch):
    """A transient init failure must not silence voice forever."""
    v = VoiceEngine(enabled=True, cooldown_seconds=0, repeat_seconds=0)
    v._supported = False
    v._engine = None
    assert v.status() == "unavailable"

    class _FakeEngine:
        def __init__(self):
            self.spoken = []

        def setProperty(self, *_):
            pass

        def say(self, msg):
            self.spoken.append(msg)

        def runAndWait(self):
            pass

    fake = _FakeEngine()
    monkeypatch.setattr("app.engine.actuators.voice.pyttsx3", type("M", (), {"init": staticmethod(lambda: fake)}))
    monkeypatch.setattr("app.engine.actuators.voice._HAVE_TTS", True)

    assert v.retry() is True
    assert v.status() == "ok"
    assert v.speak("hi", force=True) is True


# --- runtime snapshot -----------------------------------------------------
def test_runtime_snapshot_shape():
    rt = UserRuntime(user_id=999)
    snap = rt.snapshot()
    for key in (
        "ts",
        "monitoring",
        "mode",
        "calibrated",
        "present",
        "features",
        "lux",
        "factors",
        "score",
        "drift",
        "insight",
        "session",
        "devices",
    ):
        assert key in snap


def test_previous_score_avg_excludes_newest_from_deque():
    rt = UserRuntime(user_id=999)
    assert rt._previous_score_avg() == rt.score  # empty history falls back to current
    rt._score_history.extend([90.0, 80.0, 70.0])
    assert rt._previous_score_avg() == pytest.approx((90.0 + 80.0) / 2)


# --- mode switching -------------------------------------------------------
def test_set_mode_switches_and_drops_mock_features():
    rt = UserRuntime(user_id=999)
    rt.mode = "mock"
    rt.features = {"neck_angle": 0.1}
    assert rt.set_mode("real") is True
    assert rt.mode == "real"
    assert rt.snapshot()["features"] == {}  # a real session must not inherit mock frames

    assert rt.set_mode("real") is False  # idempotent: no second "change"

    rt.present = True
    assert rt.set_mode("mock") is True
    assert rt.mode == "mock"
    assert rt.present is True  # switching back does not fabricate a frame


def test_mark_break_resets_break_clock():
    rt = UserRuntime(user_id=999)
    rt._last_active = rt._last_active - timedelta(hours=2)
    stale = rt._last_active
    rt.mark_break()
    assert rt._last_active > stale


def test_runtime_welcome_speaks_once(monkeypatch):
    rt = UserRuntime(user_id=999)
    rt.voice._supported = True
    rt._welcome_pending = True
    spoken: list[str] = []
    events: list[tuple] = []
    monkeypatch.setattr(rt.voice, "speak", lambda msg, force=False: spoken.append((msg, force)) or True)
    monkeypatch.setattr(rt, "_write_event", lambda *a, **k: events.append(a))

    assert rt.welcome() is True
    assert rt._welcome_pending is False
    assert spoken and spoken[0][1] is True  # force=True bypasses cooldowns
    assert events and events[0][1] == "voice" and events[0][4] == "welcome"


def test_runtime_welcome_quiet_when_muted(monkeypatch):
    rt = UserRuntime(user_id=999)
    rt._welcome_pending = True
    monkeypatch.setattr(rt.voice, "speak", lambda msg, force=False: False)
    assert rt.welcome() is False
    assert rt._welcome_pending is False  # still consumed, so it will not repeat


def test_prefer_browser_lux_when_esp32_absent():
    rt = UserRuntime(user_id=999)
    # No ESP32 hardware -> reader reports "mock"; a fresh webcam reading wins.
    assert rt._prefer_browser_lux(420.0, "mock") == (420.0, "mock")
    rt._browser_lux = 155.0
    rt._browser_lux_ts = time.monotonic()
    assert rt._prefer_browser_lux(420.0, "mock") == (155.0, "webcam")
    assert rt._prefer_browser_lux(None, "disconnected") == (155.0, "webcam")
    # A real ESP32 reading always wins.
    assert rt._prefer_browser_lux(500.0, "ok") == (500.0, "ok")
    # A stale webcam reading is ignored.
    rt._browser_lux_ts = time.monotonic() - 60
    assert rt._prefer_browser_lux(420.0, "mock") == (420.0, "mock")


def test_feed_stores_browser_lux():
    rt = UserRuntime(user_id=999)
    rt.feed({"neck_angle": -0.3, "distance_proxy": 0.4}, lux=222.0)
    assert rt._browser_lux == 222.0
    assert rt._webcam.read()[0] is not None

