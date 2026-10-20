"""Offline voice feedback on a worker queue so it never blocks.

Primary path: render the sentence to a WAV with Windows SAPI and play it with
``winsound`` (see :mod:`.sapi`) — sturdy from any process/thread. If that is not
available we fall back to pyttsx3. Either way every prompt is gated by cooldowns
and mute, and degrades to a no-op when no TTS stack exists (headless CI,
non-Windows host). Callers log an ``Event`` when :meth:`VoiceEngine.speak`
returns True.
"""
from __future__ import annotations

import logging
import queue
import threading
import time
from dataclasses import dataclass, field

from . import sapi

try:  # pragma: no cover - depends on the host machine
    import pyttsx3  # type: ignore

    _HAVE_TTS = True
except Exception:  # pragma: no cover
    pyttsx3 = None  # type: ignore
    _HAVE_TTS = False

_log = logging.getLogger("ergosense.voice")

# A usable voice stack exists if we can render WAVs or drive pyttsx3.
_HAVE_VOICE = sapi.available() or _HAVE_TTS


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
    _last_spoken: float = field(default=0.0, init=False, repr=False)
    _last_message: str = field(default="", init=False, repr=False)
    _last_message_time: float = field(default=0.0, init=False, repr=False)
    _muted_until: float = field(default=0.0, init=False, repr=False)
    _supported: bool = field(default=_HAVE_VOICE, init=False, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    # -- lifecycle ---------------------------------------------------------
    def _speak_once(self, text: str) -> bool:
        """Speak one sentence with whatever stack is available. Blocking."""
        if sapi.available() and sapi.speak_wav(text, rate=self.rate, volume=self.volume):
            return True
        # Fallback: pyttsx3 (created and used on this same worker thread).
        if not _HAVE_TTS:
            return False
        try:  # pragma: no cover - needs audio stack
            engine = pyttsx3.init()
            engine.setProperty("volume", float(self.volume))
            engine.setProperty("rate", int(self.rate))
            engine.say(text)
            engine.runAndWait()
            return True
        except Exception:
            _log.exception("pyttsx3 fallback failed")
            return False

    def _run(self):  # pragma: no cover - needs audio stack
        while not self._stop.is_set():
            try:
                item = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            if item is None:
                break
            try:
                ok = self._speak_once(item)
                if not ok:
                    _log.warning("could not speak message")
            except Exception:
                # A single failed utterance must not kill voice for the session.
                _log.exception("voice utterance failed")

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._supported = _HAVE_VOICE
        self._thread = threading.Thread(target=self._run, name="ergosense-voice", daemon=True)
        self._thread.start()

    def retry(self) -> bool:
        """Ensure the worker thread is running after a failure (e.g. Test voice)."""
        self.start()
        return self._supported

    def stop(self) -> None:
        self._stop.set()
        self._queue.put_nowait(None)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None

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
        # Make sure the worker is alive even if start() was never called.
        self.start()
        now = time.monotonic()
        with self._lock:
            self._last_spoken = now
            self._last_message = message
            self._last_message_time = now
        self._queue.put_nowait(message)
        return True
