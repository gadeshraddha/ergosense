import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/useAuth'
import AuthShell from '../components/AuthShell'
import Icon from '../components/Icon'
import Spinner from '../components/Spinner'
import TextField from '../components/TextField'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8 // keep in sync with backend config.min_password_length

/** 0-4 rough strength score, just to give the user a hint. */
function strength(pw: string): number {
  let s = 0
  if (pw.length >= MIN_PASSWORD) s++
  if (pw.length >= 12) s++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++
  return s
}

const STRENGTH_LABEL = ['Too short', 'Weak', 'Okay', 'Good', 'Strong']
const STRENGTH_COLOR = ['bg-slate-300 dark:bg-slate-700', 'bg-red-500', 'bg-amber-500', 'bg-teal-500', 'bg-emerald-500']

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const score = password ? strength(password) : 0

  const validate = () => {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = 'Enter your name'
    if (!email.trim()) next.email = 'Enter your email'
    else if (!EMAIL_RE.test(email.trim())) next.email = 'That does not look like a valid email'
    if (password.length < MIN_PASSWORD) next.password = `Use at least ${MIN_PASSWORD} characters`
    else if (new TextEncoder().encode(password).length > 72) next.password = 'Password is too long (max 72 bytes)'
    if (confirm !== password) next.confirm = 'Passwords do not match'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!validate()) return
    setSubmitting(true)
    try {
      await register(name.trim(), email.trim(), password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Takes a few seconds. Your data stays private to your account."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
          >
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}
        <TextField
          label="Name"
          autoComplete="name"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <div>
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            placeholder={`At least ${MIN_PASSWORD} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          {password && (
            <div className="mt-2" aria-live="polite">
              <div className="flex gap-1.5">
                {[1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      i <= score ? STRENGTH_COLOR[score] : 'bg-slate-200 dark:bg-slate-800'
                    }`}
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Strength: {STRENGTH_LABEL[score]}</p>
            </div>
          )}
        </div>
        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          placeholder="Type it again"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting && <Spinner className="h-4 w-4" />}
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  )
}
