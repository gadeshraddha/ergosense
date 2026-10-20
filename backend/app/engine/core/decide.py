"""Pure decision layer: given the fused live state, what should we *do*?

This is intentionally side-effect free (no DB, no threads, no hardware) so it is
easy to unit test. It emits a list of :class:`Action` values; the runtime then
applies them (speaks, adjusts brightness, writes events) with its own gating.
Only *sustained* problems produce prompts — a single bad frame never speaks.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Action:
    kind: str  # "speak" | "brightness"
    message: str = ""
    reason: str = ""
    target: float | None = None  # for brightness actions


_LEAN = {
    "neck_angle": "Your posture has gradually drifted forward. Lean back and keep your ears over your shoulders.",
    "head_forward": "Your head is creeping forward. Tuck your chin and sit back.",
    "shoulder_tilt": "One shoulder is riding higher than the other. Relax and even them out.",
}
_BREAK = "You've been working a while without a real break. Stand up and stretch for a minute."
_LOW_LIGHT = "The room is quite dim. I can brighten the screen, or you could add some light."
_LONG_SESSION = "This has been a long session. A short break will help your eyes and back."


def decide_actions(state: dict) -> list[Action]:
    """Return the actions to attempt for this tick.

    ``state`` keys used (all optional): ``drift`` (dict with level/feature),
    ``session`` (with ``since_break_minutes``), ``lux``, ``welcome`` (a greeting
    string spoken once at session start), plus the tunables ``low_light_lux``,
    ``long_session_minutes`` and ``long_session_prompt``.
    """
    actions: list[Action] = []

    welcome = state.get("welcome")
    if welcome:
        actions.append(Action("speak", str(welcome), reason="welcome"))

    drift = state.get("drift") or {}
    if drift.get("level") in ("mild", "significant"):
        feature = drift.get("feature") or "neck_angle"
        message = _LEAN.get(feature, _LEAN["neck_angle"])
        actions.append(Action("speak", message, reason=f"drift_{drift['level']}"))

    lux = state.get("lux")
    low_light = state.get("low_light_lux")
    if lux is not None and low_light is not None and lux < low_light:
        actions.append(Action("speak", _LOW_LIGHT, reason="low_light"))

    session = state.get("session") or {}
    since_break = float(session.get("since_break_minutes", 0.0) or 0.0)
    long_minutes = state.get("long_session_minutes")
    if (
        long_minutes is not None
        and since_break >= float(long_minutes)
        and state.get("long_session_prompt", True)
    ):
        # Prefer the explicit break nudge if the session is really long.
        message = _BREAK if since_break >= float(long_minutes) * 1.2 else _LONG_SESSION
        actions.append(Action("speak", message, reason="long_session"))

    return actions
