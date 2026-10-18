import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

function readInitial(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/** Light/dark switch. The choice is remembered in the browser. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitial)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('ergosense_theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  return { theme, toggle }
}
