// Theme: 'system' follows prefers-color-scheme; 'light' and 'dark' pin
// data-theme on <html>. The database is the source of truth; localStorage
// mirrors it so the first paint uses the right theme without a flash.

import type { Theme } from '../../core/index.ts'

const STORAGE_KEY = 'hippo:theme'

/** Hero-top colours, used for the browser UI colour. */
const THEME_COLOR = { light: '#1e3a8a', dark: '#020617' } as const

export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.dataset.scheme === 'dark' ? 'dark' : 'light'
    meta.content = THEME_COLOR[theme === 'system' ? scheme : theme]
  }
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage unavailable: the database still holds the choice.
  }
}
