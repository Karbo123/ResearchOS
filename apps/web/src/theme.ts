import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

export const THEME_OPTIONS: Theme[] = ['light', 'dark']

const STORAGE_KEY = 'researchos.theme'

function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  const theme: Theme = stored === 'dark' ? 'dark' : 'light'
  window.document.documentElement.dataset.theme = theme
  return theme
}

let currentTheme: Theme = initialTheme()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getTheme(): Theme {
  return currentTheme
}

export function setTheme(theme: Theme) {
  if (theme === currentTheme) return
  currentTheme = theme
  window.localStorage.setItem(STORAGE_KEY, theme)
  window.document.documentElement.dataset.theme = theme
  listeners.forEach(listener => listener())
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, getTheme)
}
