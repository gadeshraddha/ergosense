"""ESP32 + BH1750 ambient light reader over USB serial.

Reads lines like ``LUX:312.5``. Auto-detects a COM port, reconnects on
disconnect, and falls back to a mock value if the device is absent or pyserial
is not installed. The backend must never crash because a sensor is unplugged.
"""
from __future__ import annotations

import re
import threading
import time

_LUX_RE = re.compile(r"LUX:\s*([-+]?\d*\.?\d+)", re.IGNORECASE)

try:  # pragma: no cover - exercised only when pyserial is installed
    import serial  # type: ignore
    from serial.tools import list_ports  # type: ignore

    _HAVE_PYSERIAL = True
except Exception:  # pragma: no cover
    serial = None  # type: ignore
    list_ports = None  # type: ignore
    _HAVE_PYSERIAL = False


def _candidate_ports() -> list[str]:
    if not _HAVE_PYSERIAL:
        return []
    names = []
    for p in list_ports.comports():
        desc = (p.description or "").lower()
        # Common CH340/CP210x/FTDI USB-serial descriptors used by ESP32 boards.
        if any(k in desc for k in ("ch340", "cp210", "usb-serial", "uart", "ftdi", "usb serial")):
            names.append(p.device)
    return names


class LightReader:
    """Background thread that keeps the freshest lux reading and device status."""

    def __init__(self, mock_lux: float = 420.0) -> None:
        self._mock_lux = mock_lux
        self._lock = threading.Lock()
        self._lux: float | None = None
        self._status = "mock"  # "ok" | "mock" | "disconnected"
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # -- lifecycle ---------------------------------------------------------
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="ergosense-light", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None

    # -- reading -----------------------------------------------------------
    def read(self) -> tuple[float | None, str]:
        with self._lock:
            if self._status == "mock" and self._lux is None:
                return self._mock_lux, "mock"
            return self._lux, self._status

    # -- internals ---------------------------------------------------------
    def _set(self, lux: float | None, status: str) -> None:
        with self._lock:
            if lux is not None:
                self._lux = lux
            self._status = status

    def _run(self) -> None:
        if not _HAVE_PYSERIAL:
            self._set(None, "mock")
            return
        while not self._stop.is_set():
            port = self._open_best_port()
            if port is None:
                self._set(None, "mock")
                # Nothing plugged in; poll slowly for a device appearing.
                self._stop.wait(5.0)
                continue
            try:
                self._read_from(port)
            except Exception:
                self._set(None, "disconnected")
                self._stop.wait(2.0)

    def _open_best_port(self):  # pragma: no cover - needs hardware
        for device in _candidate_ports():
            try:
                return serial.Serial(device, 115200, timeout=2.0)
            except Exception:
                continue
        return None

    def _read_from(self, port) -> None:  # pragma: no cover - needs hardware
        self._set(self._lux, "ok")
        while not self._stop.is_set():
            try:
                raw = port.readline()
            except Exception:
                self._set(None, "disconnected")
                return
            if not raw:
                continue
            try:
                line = raw.decode("utf-8", errors="ignore").strip()
            except Exception:
                continue
            m = _LUX_RE.search(line)
            if m:
                try:
                    self._set(float(m.group(1)), "ok")
                except ValueError:
                    pass
