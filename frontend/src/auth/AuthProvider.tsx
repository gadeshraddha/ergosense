import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, getToken, onUnauthorized, setToken } from '../api/client'
import type { TokenResponse, User } from '../api/types'
import { AuthContext } from './authContext'
import type { AuthState } from './authContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(() => getToken() !== null)

  // On first load: if a token is saved, ask the backend who we are.
  useEffect(() => {
    if (!getToken()) return
    let cancelled = false
    api<User>('/auth/me')
      .then((u) => {
        if (!cancelled) setUser(u)
      })
      .catch(() => {
        // Only drop the token if the server said it is invalid.
        // (If the backend is simply offline we keep it and the user stays logged out for now.)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Any 401 from a protected call means the token is bad or expired -> log out.
  useEffect(() => {
    onUnauthorized(() => {
      setToken(null)
      setUser(null)
    })
    return () => onUnauthorized(null)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<TokenResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    })
    setToken(res.access_token)
    setUser(res.user)
  }, [])

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await api<TokenResponse>('/auth/register', {
      method: 'POST',
      body: { name, email, password },
      auth: false,
    })
    setToken(res.access_token)
    setUser(res.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api<void>('/auth/logout', { method: 'POST' })
    } catch {
      /* even if the call fails we still log out locally */
    }
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
