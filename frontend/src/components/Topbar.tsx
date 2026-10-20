import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useHealth } from '../hooks/useHealth'
import { useMonitoring } from '../monitoring/MonitoringProvider'
import Icon from './Icon'
import ThemeToggle from './ThemeToggle'

function MonitoringControl() {
  const { data, connected, busy, start, stop } = useMonitoring()
  const monitoring = data?.monitoring ?? false
  return (
    <button
      type="button"
      onClick={() => (monitoring ? stop() : start())}
      disabled={busy}
      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
        monitoring
          ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300'
          : 'bg-teal-600 text-white hover:bg-teal-700'
      }`}
      title={connected ? 'Live stream connected' : 'Live stream disconnected'}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          monitoring ? (connected ? 'animate-pulse bg-rose-500' : 'bg-rose-400') : 'bg-teal-200'
        }`}
      />
      {monitoring ? 'Stop' : 'Start monitoring'}
    </button>
  )
}

function ApiStatus() {
  const health = useHealth()
  const dot =
    health.status === 'online' ? 'bg-emerald-500' : health.status === 'offline' ? 'bg-red-500' : 'bg-amber-400'
  const text =
    health.status === 'online'
      ? `API online${health.mock ? ' · mock sensors' : ' · real sensors'}`
      : health.status === 'offline'
        ? 'API offline'
        : 'Checking…'
  return (
    <div
      className="hidden items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300 sm:flex"
      role="status"
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {text}
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null

  const handleLogout = async () => {
    setOpen(false)
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg p-1.5 pr-2 transition hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-xs font-semibold text-white">
          {initials(user.name)}
        </span>
        <span className="hidden max-w-[140px] truncate text-sm font-medium sm:block">{user.name}</span>
        <Icon name="chevronDown" className="h-4 w-4 text-slate-400" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Icon name="logout" className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  )
}

export default function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 sm:px-6">
      <button
        type="button"
        onClick={onOpenMobile}
        aria-label="Open menu"
        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
      >
        <Icon name="menu" />
      </button>
      <div className="hidden lg:block" />
      <div className="flex items-center gap-2 sm:gap-3">
        <MonitoringControl />
        <ApiStatus />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  )
}
