"""Auto screen brightness: map ambient lux to a target brightness %.

The mapping is a smooth log-like curve so the screen is dim in a dark room and
bright in a sunlit one. Changes are rate-limited and gated by a deadband so the
screen never flickers or "hunts". If ``screen_brightness_control`` is missing or
the laptop does not expose brightness, we still *compute* and report the target
and mark the device ``unsupported`` — never crash.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

try:  # pragma: no cover - depends on the host machine
    import screen_brightness_control as sbc  # type: ignore

    _HAVE_SBC = True
except Exception:  # pragma: no cover
    sbc = None  # type: ignore
    _HAVE_SBC = False


def lux_to_target(
    lux: float | None,
    *,
    comfort_min: float,
    comfort_max: float,
    min_pct: float,
    max_pct: float,
    dark_factor: float = 0.55,
) -> float:
    """Return a target brightness in percent for a lux reading.

    * ``lux`` at/under the dark edge (``comfort_min * dark_factor``) -> ``min_pct``.
    * Inside the comfort band -> a gentle ramp that is comfortable for reading.
    * Above the band -> climb toward ``max_pct`` on a log curve.
    A ``None`` lux (no sensor) returns a neutral mid value.
    """
    if lux is None:
        return round((min_pct + max_pct) / 2.0, 1)

    dark_edge = max(1.0, comfort_min * dark_factor)
    span = max(1.0, comfort_max - dark_edge)

    if lux <= dark_edge:
        pct = min_pct
    elif lux <= comfort_max:
        # Smooth ramp from min_pct up to ~70% across the comfort band.
        frac = (lux - dark_edge) / span
        pct = min_pct + (0.70 * (max_pct - min_pct)) * frac
    else:
        # Log-ish climb past the comfort band, capped at max_pct.
        over = math.log1p(lux - comfort_max) / math.log1p(4000.0)
        pct = min_pct + (max_pct - min_pct) * min(1.0, 0.70 + 0.30 * over)

    return round(max(min_pct, min(max_pct, pct)), 1)


@dataclass
class BrightnessController:
    """Stateful applier: deadband + rate-limit + optional real hardware control."""

    min_pct: float = 20.0
    max_pct: float = 100.0
    deadband_pct: float = 3.0
    min_interval_s: float = 5.0
    auto_pause_minutes: float = 5.0

    _last_applied: float | None = field(default=None, init=False, repr=False)
    _last_change: float = field(default=0.0, init=False, repr=False)
    _paused_until: float = field(default=0.0, init=False, repr=False)
    _supported: bool = field(default=_HAVE_SBC, init=False, repr=False)

    @property
    def supported(self) -> bool:
        return self._supported

    def status(self) -> str:
        return "ok" if self._supported else "unsupported"

    def paused(self) -> bool:
        return time.monotonic() < self._paused_until

    def current(self) -> float | None:
        """Read the real current brightness, if supported."""
        if not self._supported:
            return None
        try:  # pragma: no cover - needs hardware
            got = sbc.get_brightness()
            if isinstance(got, list) and got:
                return float(got[0])
            return float(got)
        except Exception:  # pragma: no cover
            self._supported = False
            return None

    def apply(self, target: float, *, manual: bool = False) -> tuple[float, bool]:
        """Try to move the screen to ``target``.

        Returns ``(target, changed)``. ``changed`` is True only when we actually
        issued a change (past deadband, rate-limit, and any manual pause).
        """
        now = time.monotonic()

        if not manual and now < self._paused_until:
            return target, False

        if self._last_applied is not None and abs(target - self._last_applied) < self.deadband_pct:
            return target, False

        if not manual and (now - self._last_change) < self.min_interval_s:
            return target, False

        if self._supported:
            try:  # pragma: no cover - needs hardware
                sbc.set_brightness(target)
            except Exception:  # pragma: no cover
                self._supported = False

        self._last_applied = target
        self._last_change = now
        if manual:
            self._paused_until = now + self.auto_pause_minutes * 60.0
        return target, True
