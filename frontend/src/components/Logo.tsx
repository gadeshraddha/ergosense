export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#0d9488" />
      <path
        d="M10 34h11l6-14 10 26 7-18h10"
        fill="none"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function Logo({ showText = true, light = false }: { showText?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      {showText && (
        <span
          className={`text-xl font-semibold tracking-tight ${light ? 'text-white' : 'text-slate-900 dark:text-white'}`}
        >
          Ergo<span className={light ? 'text-teal-200' : 'text-teal-600 dark:text-teal-400'}>Sense</span>
        </span>
      )}
    </div>
  )
}
