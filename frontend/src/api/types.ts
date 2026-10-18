/** Shapes returned by the backend. Keep in sync with backend/app/schemas.py */

export interface User {
  id: number
  name: string
  email: string
  created_at: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  user: User
}

export interface Health {
  status: string
  mock: boolean
  app: string
}
