import { useCallback, useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api/client'
import type { SessionStats } from '../api/types'
import PageHeader from '../components/PageHeader'
import { Card, EmptyState, ScoreChip, StatCard, StatusBadge } from '../components/ui'
import { useMonitoring } from '../monitoring/MonitoringProvider'

function minutes(value: number): string {
  if (value < 60) return `${Math.round(value)}m`
  const h = Math.floor(value / 60)
  const m = Math.round(value % 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString([], { weekday: 'short' })
}

export default function Sessions() {
  const { data: live } = useMonitoring()
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setStats(await api<SessionStats>('/sessions/stats'))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your sessions')
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 8000)
    return () => window.clearInterval(id)
  }, [load])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2500)
    return () => window.clearTimeout(id)
  }, [toast])

  const takeBreak = async () => {
    setBusy(true)
    try {
      await api('/sessions/break', { method: 'POST' })
      setToast('Break logged. Your time-since-break clock restarted.')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const monitoring = live?.monitoring ?? false
  const sinceBreak = live?.session.since_break_minutes ?? null
  const sessionMinutes = live?.session.minutes ?? null
  const nextBreak = stats?.next_break_minutes ?? null
  const chart = (stats?.by_day ?? []).map((d) => ({ ...d, label: dayLabel(d.day) }))

  return (
    <>
      <PageHeader
        title="Sessions"
        description="How long you work, and when you take breaks."
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge tone={live?.session.state === 'break' ? 'warning' : monitoring ? 'good' : 'neutral'}>
              {live?.session.state === 'break' ? 'On a break' : monitoring ? 'Working' : 'Idle'}
            </StatusBadge>
            <button
              type="button"
              disabled={busy}
              onClick={takeBreak}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
            >
              I took a break
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}
      {toast && (
        <div className="mb-6 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-300">
          {toast}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="This session"
          value={monitoring && sessionMinutes != null ? minutes(sessionMinutes) : '—'}
          caption={monitoring ? 'Since you pressed Start' : 'Monitoring is off'}
        />
        <StatCard
          label="Since last break"
          value={sinceBreak != null ? minutes(sinceBreak) : '—'}
          tone={sinceBreak != null && sinceBreak >= 50 ? 'warning' : 'neutral'}
          caption={nextBreak != null ? `Next break suggested in ${minutes(nextBreak)}` : 'Break clock'}
        />
        <StatCard
          label="Worked today"
          value={stats ? minutes(stats.today_minutes) : '—'}
          caption={stats ? `${stats.today_sessions} session${stats.today_sessions === 1 ? '' : 's'} • ${stats.today_breaks} breaks` : ''}
        />
        <StatCard
          label="Last 7 days"
          value={stats ? minutes(stats.week_minutes) : '—'}
          caption={stats ? `${stats.week_breaks} breaks logged` : ''}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card
          title="Work time per day"
          hint="Bars are real work minutes; the number above each bar is that day's breaks."
          className="lg:col-span-2"
        >
          {chart.some((d) => d.work_minutes > 0) ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 16, right: 16, bottom: 4, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={(v: number) => `${Math.round(v / 60)}h`} />
                  <Tooltip
                    formatter={(value, name) =>
                      name === 'work_minutes'
                        ? [minutes(Number(value)), 'Worked']
                        : [String(value), String(name)]
                    }
                    labelFormatter={(l, payload) => {
                      const row = payload?.[0]?.payload as { breaks?: number; day?: string } | undefined
                      const base = row?.day ? new Date(`${row.day}T00:00:00`).toLocaleDateString() : String(l)
                      return row ? `${base} — ${row.breaks ?? 0} breaks` : base
                    }}
                  />
                  <Bar dataKey="work_minutes" fill="#0d9488" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="No work time recorded yet"
              message="Your first monitored session will show up here as work minutes per day."
            />
          )}
        </Card>

        <Card title="Today's average score">
          {stats?.today_avg_score != null ? (
            <>
              <p className="text-3xl font-bold">{Math.round(stats.today_avg_score)}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Average across today's finished sessions.
              </p>
            </>
          ) : (
            <EmptyState
              title="No finished session today"
              message="A session's average score is calculated when you stop monitoring."
            />
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Past sessions">
          {stats && stats.sessions.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    <th className="pb-2 pr-4 font-semibold">Started</th>
                    <th className="pb-2 pr-4 font-semibold">Duration</th>
                    <th className="pb-2 pr-4 font-semibold">Avg score</th>
                    <th className="pb-2 font-semibold">Breaks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {stats.sessions.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2 pr-4">
                        {new Date(s.start).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {s.end === null && (
                          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            running
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {clock(s.start)}
                        {s.end ? ` – ${clock(s.end)}` : ' – now'} ({minutes(s.minutes)})
                      </td>
                      <td className="py-2 pr-4">
                        {s.avg_score != null ? <ScoreChip score={s.avg_score} /> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="py-2">{s.break_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No sessions yet"
              message="Press Start in the top bar to begin your first monitored work session."
            />
          )}
        </Card>
      </div>
    </>
  )
}
