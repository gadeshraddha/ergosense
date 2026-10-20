import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import type { AppSettings } from '../api/types'
import { ScoreChip, scoreTone } from './ui'
import Icon from './Icon'
import { useMonitoring } from '../monitoring/MonitoringProvider'
import { attachDetectionVideo, setPipActive } from '../hooks/usePostureTracking'

const OPEN_KEY = 'ergosense_ergo_open'
const PIP_DISMISSED_KEY = 'ergosense_ergo_pip_dismissed'

/** Minimal typing for the Document Picture-in-Picture API (Chrome/Edge). */
interface DocumentPiP {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>
  window: Window | null
}
declare global {
  interface Window {
    documentPictureInPicture?: DocumentPiP
  }
}

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

function pipSupported(): boolean {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window
}

function loadPipDismissed(): boolean {
  try {
    return localStorage.getItem(PIP_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function markPipDismissed(): void {
  try {
    localStorage.setItem(PIP_DISMISSED_KEY, '1')
  } catch {
    /* ignore */
  }
}

/**
 * "Ergo" — a small floating companion that follows you across apps.
 *
 * In Chrome/Edge it pops out into an always-on-top Document Picture-in-Picture
 * window, so it stays visible over YouTube, Word, etc. That visible window also
 * keeps the browser running our posture/light processing while the main tab is
 * in the background, so monitoring keeps going until you press Stop. In other
 * browsers it falls back to an in-page floating widget.
 */
export default function ErgoCompanion() {
  const { data: live } = useMonitoring()
  const [open, setOpen] = useState(loadOpen)
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const [pipError, setPipError] = useState<string | null>(null)
  const pipRef = useRef<Window | null>(null)
  const autoTriedRef = useRef(false)
  const dismissedRef = useRef(loadPipDismissed())

  // Keep the camera hook informed: a PiP window keeps us "visible".
  useEffect(() => {
    setPipActive(pipWindow != null)
    return () => setPipActive(false)
  }, [pipWindow])

  const closePip = useCallback(() => {
    pipRef.current = null
    setPipWindow(null)
    // Put the detection video back in the main page.
    attachDetectionVideo(null)
    // Remember the user closed it, so we do not auto-reopen on every start.
    markPipDismissed()
    dismissedRef.current = true
  }, [])

  const openPip = useCallback(async (): Promise<boolean> => {
    const pip = window.documentPictureInPicture
    if (!pip) {
      setPipError('This browser cannot float the companion. Use Chrome or Edge for the always-on-top window.')
      return false
    }
    if (pip.window) {
      try {
        pip.window.focus()
      } catch {
        /* ignore */
      }
      return true
    }
    try {
      const win = await pip.requestWindow({ width: 320, height: 340 })
      pipRef.current = win
      // Copy stylesheets so Tailwind classes render in the PiP document.
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = Array.from(sheet.cssRules)
            .map((r) => r.cssText)
            .join('')
          const style = win.document.createElement('style')
          style.textContent = rules
          win.document.head.appendChild(style)
        } catch {
          // Cross-origin sheet (e.g. fonts): fall back to a <link>.
          const link = sheet.ownerNode as HTMLLinkElement | null
          if (link?.href) {
            const el = win.document.createElement('link')
            el.rel = 'stylesheet'
            el.href = link.href
            win.document.head.appendChild(el)
          }
        }
      }
      win.document.documentElement.className = document.documentElement.className
      win.document.body.className = document.body.className
      win.document.body.style.margin = '0'
      win.addEventListener('pagehide', closePip)
      // Adopt the detection video so the browser keeps playing it while the main
      // tab is hidden (a visible surface is not throttled).
      attachDetectionVideo(win.document.body)
      setPipError(null)
      setPipWindow(win)
      return true
    } catch (e) {
      setPipError(e instanceof Error ? e.message : 'Could not open the companion window.')
      return false
    }
  }, [closePip])

  // Auto-pop the companion out the first time monitoring starts, so it is
  // always-on-top without the user hunting for the button. Respects a dismissal.
  useEffect(() => {
    if (!live?.monitoring || pipWindow || autoTriedRef.current || dismissedRef.current) return
    if (!pipSupported()) return
    autoTriedRef.current = true
    void openPip()
  }, [live?.monitoring, pipWindow, openPip])

  const persist = (value: boolean) => {
    setOpen(value)
    try {
      localStorage.setItem(OPEN_KEY, value ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  const view = (
    <CompanionView
      live={live}
      open={open}
      inPip={pipWindow != null}
      pipSupported={pipSupported()}
      pipError={pipError}
      onMinimise={() => persist(false)}
      onExpand={() => persist(true)}
      onPopOut={openPip}
      onClosePip={() => pipRef.current?.close()}
    />
  )

  // While popped out, render *only* into the PiP window (not the page).
  if (pipWindow) {
    return (
      <>
        {createPortal(view, pipWindow.document.body)}
        <button
          type="button"
          onClick={() => void openPip()}
          title="Ergo is popped out — click to focus the window"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border-2 border-teal-400 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-lg dark:bg-slate-800 dark:text-slate-200"
        >
          Ergo ↗ <span className="hidden sm:inline">always on top</span>
        </button>
      </>
    )
  }

  return view
}

function CompanionView({
  live,
  open,
  inPip,
  pipSupported,
  pipError,
  onMinimise,
  onExpand,
  onPopOut,
  onClosePip,
}: {
  live: ReturnType<typeof useMonitoring>['data']
  open: boolean
  inPip: boolean
  pipSupported: boolean
  pipError: string | null
  onMinimise: () => void
  onExpand: () => void
  onPopOut: () => void
  onClosePip: () => void
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    const load = () =>
      api<AppSettings>('/settings')
        .then((s) => active && setSettings(s))
        .catch(() => undefined)
    void load()
    const id = window.setInterval(load, 30000)
    return () => {
      active = false
      window.clearInterval(id)
    }
  }, [])

  const toggleVoice = async () => {
    if (!settings) return
    setBusy(true)
    try {
      const next = !settings.voice_enabled
      const s = await api<AppSettings>('/settings', { method: 'PUT', body: { voice_enabled: next } })
      setSettings(s)
    } catch {
      /* ignore; the control will retry on the next poll */
    } finally {
      setBusy(false)
    }
  }

  const score = live?.score ?? null
  const tone = score == null ? 'neutral' : scoreTone(score)
  const driftLevel = live?.drift?.level ?? 'none'
  const toneRing =
    tone === 'good'
      ? 'border-emerald-400'
      : tone === 'warning'
        ? 'border-amber-400'
        : tone === 'danger'
          ? 'border-rose-400'
          : 'border-slate-300 dark:border-slate-700'

  const shell = inPip
    ? 'flex h-screen flex-col bg-white dark:bg-slate-900'
    : 'fixed bottom-5 right-5 z-40 w-72 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900'

  if (!open) {
    return (
      <button
        type="button"
        onClick={onExpand}
        title="Open Ergo"
        className={`${inPip ? 'm-3' : 'fixed bottom-5 right-5 z-40'} flex h-14 w-14 items-center justify-center rounded-full border-2 bg-white shadow-lg transition hover:scale-105 dark:bg-slate-800 ${toneRing}`}
      >
        <span className="text-lg font-bold">{score == null ? '∑' : Math.round(score)}</span>
      </button>
    )
  }

  return (
    <div className={shell}>
      <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/60">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${live?.monitoring ? 'animate-pulse bg-emerald-500' : 'bg-slate-400'}`} />
          <span className="text-sm font-semibold">Ergo</span>
          <span className="text-xs text-slate-400">{live?.monitoring ? 'live' : 'idle'}</span>
        </div>
        <div className="flex items-center gap-1">
          {pipSupported && !inPip && (
            <button
              type="button"
              onClick={onPopOut}
              aria-label="Pop out Ergo"
              title="Float over other apps (always on top)"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-teal-600 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-500/10"
            >
              <Icon name="chevronRight" className="h-3.5 w-3.5" /> Float
            </button>
          )}
          {inPip && (
            <button
              type="button"
              onClick={onClosePip}
              aria-label="Close companion window"
              title="Close window"
              className="rounded-md px-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
            >
              ✕
            </button>
          )}
          <button
            type="button"
            onClick={onMinimise}
            aria-label="Minimise Ergo"
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
          >
            <Icon name="chevronDown" className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ergo Score</p>
            <p className="mt-0.5 text-3xl font-bold">{score == null ? '—' : Math.round(score)}</p>
          </div>
          {score != null && <ScoreChip score={score} />}
        </div>

        {driftLevel !== 'none' && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            Drift detected: {live?.drift.feature.replace('_', ' ')} for {Math.round(live?.drift.minutes ?? 0)} min.
          </div>
        )}

        <p className="mt-3 line-clamp-3 text-sm text-slate-600 dark:text-slate-300">
          {live?.insight ?? 'Start monitoring to see how you are doing.'}
        </p>

        <button
          type="button"
          disabled={busy || !settings}
          onClick={toggleVoice}
          className={`mt-4 w-full rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-50 ${
            settings?.voice_enabled
              ? 'bg-teal-600 text-white hover:bg-teal-700'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {settings?.voice_enabled ? 'Voice: on (tap to mute)' : 'Voice: muted (tap to enable)'}
        </button>
        {settings && !settings.voice_supported && (
          <p className="mt-2 text-[11px] text-slate-400">
            Voice is not available on this machine, but alerts are still recorded.
          </p>
        )}
        {pipError && !inPip && (
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">{pipError}</p>
        )}
        {pipSupported && !inPip && !pipError && (
          <p className="mt-2 text-[11px] text-slate-400">
            Tip: tap <span className="font-semibold">Float</span> to keep Ergo over other apps and
            keep monitoring while you work elsewhere.
          </p>
        )}
      </div>
    </div>
  )
}
