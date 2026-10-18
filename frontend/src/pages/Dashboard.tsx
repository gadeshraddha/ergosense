import type { ReactNode } from 'react'
import { useAuth } from '../auth/useAuth'
import Icon from '../components/Icon'
import type { IconName } from '../components/Icon'
import PageHeader from '../components/PageHeader'
import { useHealth } from '../hooks/useHealth'

function InfoCard({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

const ROADMAP = [
  { module: 'M2', text: 'Live sensor engine: webcam posture + light stream (mock mode works with no hardware)' },
  { module: 'M3', text: 'Calibration wizard, personal baseline, drift detection, Ergo Score and explanations' },
  { module: 'M4', text: 'This dashboard turns live: score gauge, factor cards and the AI insight' },
  { module: 'M5', text: 'Auto-brightness, voice feedback, alerts and settings' },
  { module: 'M6', text: 'Sessions, history charts, demo mode' },
]

export default function Dashboard() {
  const { user } = useAuth()
  const health = useHealth()
  const firstName = user?.name.split(' ')[0] ?? ''
  const memberSince = user
    ? new Date(user.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : ''

  return (
    <>
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="Your live workstation overview arrives with module M4. Until then, here is a system check."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <InfoCard icon="server" title="Backend">
          {health.status === 'checking' && <p className="text-lg font-semibold text-amber-600">Checking…</p>}
          {health.status === 'online' && (
            <>
              <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">Online</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{health.app} API is responding</p>
            </>
          )}
          {health.status === 'offline' && (
            <>
              <p className="text-lg font-semibold text-red-600 dark:text-red-400">Offline</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Start the backend (see README) and this will turn green by itself.
              </p>
            </>
          )}
        </InfoCard>

        <InfoCard icon="chip" title="Sensor mode">
          {health.status === 'online' ? (
            <>
              <p className="text-lg font-semibold">{health.mock ? 'Mock sensors' : 'Real hardware'}</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {health.mock
                  ? 'Simulated posture and light, no webcam or ESP32 needed.'
                  : 'Using the webcam and ESP32.'}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Unknown until the backend is online.</p>
          )}
        </InfoCard>

        <InfoCard icon="dashboard" title="Your account">
          <p className="truncate text-lg font-semibold">{user?.name}</p>
          <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{user?.email}</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Member since {memberSince}</p>
        </InfoCard>
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold">What is coming next</h2>
        <ol className="mt-4 space-y-3">
          {ROADMAP.map((item) => (
            <li key={item.module} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 rounded-md bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
                {item.module}
              </span>
              <span className="text-slate-600 dark:text-slate-300">{item.text}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
