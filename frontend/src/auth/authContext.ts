import { createContext } from 'react'
import type { User } from '../api/types'

export interface AuthState {
  user: User | null
  /** true while we check a saved token on first load */
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)
