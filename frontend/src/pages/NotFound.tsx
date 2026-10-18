import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-5xl font-semibold text-teal-600">404</p>
      <h1 className="mt-3 text-xl font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">That address does not exist in ErgoSense.</p>
      <Link
        to="/dashboard"
        className="mt-6 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
      >
        Back to dashboard
      </Link>
    </div>
  )
}
