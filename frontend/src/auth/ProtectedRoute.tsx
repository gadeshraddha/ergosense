import { Navigate, Outlet, useLocation } from 'react-router-dom'
import Spinner from '../components/Spinner'
import { useAuth } from './useAuth'

/** Wrap pages that need a login. Logged-out visitors are sent to /login. */
export function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-teal-600" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

/** Wrap /login and /register: already-logged-in users go straight to the dashboard. */
export function GuestRoute() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-teal-600" />
      </div>
    )
  }
  if (user) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
