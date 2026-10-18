import type { ReactNode } from 'react'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'

const LOOP = ['Sense', 'Learn your baseline', 'Detect drift', 'Score', 'Explain', 'Act']

/** Split screen used by Login and Register: brand panel on the left, form on the right. */
export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel (hidden on small screens) */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-teal-700 via-teal-800 to-slate-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal-400/20 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-emerald-300/10 blur-3xl"
          aria-hidden="true"
        />
        <Logo light />
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            A workstation that notices before your back does.
          </h2>
          <p className="mt-4 text-teal-50/80">
            ErgoSense watches your posture and room light, learns what is normal for you, and gently steps in when
            things drift.
          </p>
          <ol className="mt-10 grid grid-cols-2 gap-x-6 gap-y-3 text-sm text-teal-50/90">
            {LOOP.map((step, i) => (
              <li key={step} className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-xs font-medium">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
        <p className="relative text-xs text-teal-100/60">Posture · Light · Sessions · Explainable score</p>
      </aside>

      {/* Form panel */}
      <main className="relative flex items-center justify-center px-5 py-12 sm:px-8">
        <ThemeToggle className="absolute right-4 top-4" />
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">{footer}</div>
        </div>
      </main>
    </div>
  )
}
