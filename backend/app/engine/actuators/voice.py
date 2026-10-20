"""Offline voice feedback (pyttsx3) on a worker queue so it never blocks.

Every spoken prompt is gated by cooldowns and mute, and degrades to a no-op if
pyttsx3 is unavailable (headless CI, missing drivers, etc.). Callers log an
``Event`` when :meth:`VoiceEngine.speak` returns True.
"""
from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass, field

try:  # pragma: no cover - depends on the host machine
    import pyttsx3  # type: ignore

    _HAVE_TTS = True
except Exception:  # pragma: no cover
    pyttsx3 = None  # type: ignore
    _HAVE_TTS = False


@dataclass
class VoiceEngine:
    enabled: bool = True
    volume: float = 0.9
    rate: int = 175
    cooldown_seconds: float = 180.0
    repeat_seconds: float = 600.0

    _queue: queue.Queue = field(default_factory=queue.Queue, init=False, repr=False)
    _thread: threading.Thread | None = field(default=None, init=False, repr=False)
    _stop: threading.Event = field(default_factory=threading.Event, init=False, repr=False)
    _engine: object | None = field(default=None, init=False, repr=False)
    _last_spoken: float = field(default=0.0, init=False, repr=False)
    _last_message: str = field(default="", init=False, repr=False)
    _last_message_time: float = field(default=0.0, init=False, repr=False)
    _muted_until: float = field(default=0.0, init=False, repr=False)
    _supported: bool = field(default=_HAVE_TTS, init=False, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    # -- lifecycle ---------------------------------------------------------
    def _try_init(self) -> bool:
        """Try to bring up the TTS engine. Safe to call repeatedly.

        ``pyttsx3`` can fail transiently (audio device busy, driver hiccup), so
        we never latch ``_supported=False`` forever: a later call re-attempts
        init. Returns True when an engine is ready.
        """
        if not _HAVE_TTS:
            self._supported = False
            return False
        if self._engine is not None:
            self._supported = True
            return True
        try:  # pragma: no cover - needs audio stack
            engine = pyttsx3.init()
            engine.setProperty("volume", float(self.volume))
            engine.setProperty("rate", int(self.rate))
            self._engine = engine
            self._supported = True
            return True
        except Exception:  # pragma: no cover
            self._supported = False
            self._engine = None
            return False

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        if not self._try_init():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="ergosense-voice", daemon=True)
        self._thread.start()

    def retry(self) -> bool:
        """Re-attempt to bring the engine up after a failure (e.g. Test voice)."""
        if self._try_init() and not (self._thread and self._thread.is_alive()):
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name="ergosense-voice", daemon=True)
            self._thread.start()
        return self._supported

    def stop(self) -> None:
        self._stop.set()
        self._queue.put_nowait(None)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None
        # Drop the engine so the next start() re-inits cleanly (pyttsx3 engines
        # are not reliably reusable after a stop, especially on SAPI5).
        self._engine = None

    # -- controls ----------------------------------------------------------
    @property
    def supported(self) -> bool:
        return self._supported

    def status(self) -> str:
        if not self._supported:
            return "unavailable"
        if self.muted() or not self.enabled:
            return "muted"
        return "ok"

    def muted(self) -> bool:
        return time.monotonic() < self._muted_until

    def mute(self, minutes: float) -> None:
        self._muted_until = time.monotonic() + minutes * 60.0

    def unmute(self) -> None:
        self._muted_until = 0.0

    def set_enabled(self, on: bool) -> None:
        self.enabled = bool(on)

    # -- speaking ----------------------------------------------------------
    def can_speak(self, message: str) -> bool:
        """Pure gate: respects enabled, mute, global cooldown and same-message repeat."""
        if not self.enabled or not self._supported:
            return False
        now = time.monotonic()
        if now < self._muted_until:
            return False
        if now - self._last_spoken < self.cooldown_seconds:
            return False
        if message == self._last_message and now - self._last_message_time < self.repeat_seconds:
            return False
        return True

    def speak(self, message: str, *, force: bool = False) -> bool:
        """Queue a prompt. Returns True if it was accepted for speaking."""
        if not self._supported:
            # Self-heal: a transient init failure should not silence us forever.
            self.retry()
        if force:
            ok = self._supported and not self.muted()
        else:
            ok = self.can_speak(message)
        if not ok:
            return False
        now = time.monotonic()
        with self._lock:
            self._last_spoken = now
            self._last_message = message
            self._last_message_time = now
        self._queue.put_nowait(message)
        return True

    # -- internals ---------------------------------------------------------
    def _run(self) -> None:  # pragma: no cover - needs audio stack
        while not self._stop.is_set():
            try:
                item = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            if item is None:
                break
            try:
                if self._engine is None:
                    # Engine went away (e.g. after a stop) - rebuild lazily.
                    self._try_init()
                if self._engine is not None:
                    self._engine.say(item)
                    self._engine.runAndWait()
            except Exception:
                # A single failed utterance must not kill voice for the session.
                self._engine = None
                self._supported = False
