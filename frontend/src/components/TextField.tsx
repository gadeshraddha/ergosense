import { useId, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import Icon from './Icon'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

/** Label + input + error line. Passwords get a show/hide button. */
export default function TextField({ label, error, hint, type = 'text', className = '', ...rest }: TextFieldProps) {
  const id = useId()
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && show ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className={`w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-2 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500 ${
            error
              ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20 dark:border-red-500/70'
              : 'border-slate-300 focus:border-teal-500 focus:ring-teal-500/20 dark:border-slate-700'
          } ${isPassword ? 'pr-11' : ''} ${className}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <Icon name={show ? 'eyeOff' : 'eye'} className="h-4.5 w-4.5" />
          </button>
        )}
      </div>
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      ) : null}
    </div>
  )
}
