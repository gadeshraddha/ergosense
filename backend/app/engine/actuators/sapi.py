"""Windows SAPI text-to-speech rendered to a WAV, played via ``winsound``.

pyttsx3 drives SAPI through COM events and a message pump, which is unreliable
from a background/non-interactive process (the classic "it logs 'finished' but
nothing is audible" case). This helper takes a simpler, sturdier route:

1. Synthesise the sentence to a temporary ``.wav`` using SAPI's ``SpFileStream``
   (no audio device needed for this step).
2. Play that file with ``winsound.PlaySound``.

Both steps work from any thread and any process on Windows. On non-Windows hosts
or when the COM/audio stack is missing, :func:`speak_wav` returns False so the
caller can fall back to pyttsx3 or stay silent.

All COM objects are created and used on the *same* thread inside a single call,
so there is no cross-thread COM affinity problem.
"""
from __future__ import annotations

import logging
import os
import tempfile

log = logging.getLogger("ergosense.voice")

try:  # pragma: no cover - platform dependent
    import pythoncom  # type: ignore
    import win32com.client  # type: ignore
    import winsound  # type: ignore

    _HAVE_SAPI = True
except Exception:  # pragma: no cover
    _HAVE_SAPI = False


def available() -> bool:
    return _HAVE_SAPI


def speak_wav(text: str, *, rate: int = 175, volume: float = 0.9) -> bool:
    """Synthesise ``text`` to a temp WAV and play it. Returns True on success.

    ``rate`` is words-per-minute (mapped to SAPI's -10..10 scale); ``volume`` is
    0..1. Blocking: returns after the audio finishes (or immediately on failure).
    """
    if not _HAVE_SAPI or not text.strip():
        return False

    path = ""
    com_ready = False
    try:  # pragma: no cover - needs the Windows audio/COM stack
        pythoncom.CoInitialize()
        com_ready = True

        voice = win32com.client.Dispatch("SAPI.SpVoice")
        voice.Volume = max(0, min(100, int(round(volume * 100))))
        # SAPI Rate is -10 (slow) .. +10 (fast); ~200 wpm is the neutral 0.
        voice.Rate = max(-10, min(10, int(round((rate - 200) / 20.0))))

        stream = win32com.client.Dispatch("SAPI.SpFileStream")
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        # SSFMCreateForWrite = 3
        stream.Open(path, 3, False)
        voice.AudioOutputStream = stream
        voice.Speak(text)
        stream.Close()

        winsound.PlaySound(path, winsound.SND_FILENAME)
        return True
    except Exception:
        log.exception("SAPI WAV synthesis/playback failed")
        return False
    finally:
        if path:
            try:
                os.remove(path)
            except OSError:
                pass
        if com_ready:
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass
