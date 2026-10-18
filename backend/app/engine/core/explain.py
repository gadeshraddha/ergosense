"""Human-readable explanations of *why* the score changed.

Pick the factor that contributed most to a recent fall (vs a short recent
average of that factor) and write a plain sentence. If posture is the culprit,
reference the personal baseline and the gradual drift (slightly leaning
forward, or the measured offset over time) rather than one stray frame.
"""
from __future__ import annotations


def explain_change(
    *,
    score_now: float,
    score_prev: float,
    factors_now: dict[str, float],
    factors_recent_avg: dict[str, float],
    drift: dict,
    baseline_present: bool,
) -> str:
    if score_now >= score_prev - 1.0 and score_now <= score_prev + 1.0:
        return "Holding steady. Keep your head aligned and take a micro-break every 30 minutes."

    if score_now > score_prev + 2.0:
        return "Score improving. Good to see you're easing back towards your normal posture."

    # score dropped
    worst: tuple[str, float] | None = None
    for name in ("posture", "screen", "lighting", "movement"):
        drop = (factors_recent_avg.get(name, 100.0) or 100.0) - (factors_now.get(name, 100.0) or 100.0)
        if drop <= 0:
            continue
        if worst is None or drop > worst[1]:
            worst = (name, drop)

    if worst is None:
        return "Score dropped slightly. Sit back, relax your shoulders and check your posture."

    name, drop = worst
    if name == "posture":
        if drift.get("level") == "significant":
            return (
                "Your score dropped mainly because your posture has gradually drifted "
                f"from your personal baseline ({drift.get('feature', 'forward lean')}) "
                f"over the last {int(drift.get('minutes', 0)) or 1} minutes."
            )
        if drift.get("level") == "mild":
            return (
                "Posture is trending away from your personal baseline. "
                "Lean back slightly and keep your ears over your shoulders."
            )
        if baseline_present:
            return (
                "You're leaning a little forward compared to how you calibrated. "
                "Tuck your chin and sit back to recover."
            )
        return "You're leaning forward. Try to keep your head upright and back a little."

    if name == "screen":
        return "You're getting a little too close to the screen. Move your laptop slightly further away."

    if name == "lighting":
        return "The lighting shifted outside your comfort range. Adjust screen brightness or room lighting."

    if name == "movement":
        return "You've been fairly still for a while. A short stretch or walking break will help."

    return "Small change detected. Take a moment to reset to your relaxed, normal position."
