// Pure decisions for the app shell (shell.ts), kept apart so they are tested
// without Capacitor: what the Back button does, which system bar icons to
// use, and what to make of a share that arrived from another app.

/** Screens reached from the bottom navigation, and setup. Back from one of them with no history leaves the app. */
const TOP_LEVEL = new Set(['/', '/wishlist', '/lists', '/settings'])

export type BackAction = 'close-sheet' | 'history-back' | 'go-home' | 'leave'

export interface BackState {
  /** A bottom sheet (modal dialog) is open. */
  sheetOpen: boolean
  /** Index of this history entry since the app started (motionLocation's `historyIndex`). */
  historyIndex: number
  /** The route path, e.g. `/item/new`. */
  path: string
}

/**
 * Android Back: close an open sheet first, then go back in history, then leave the app from a
 * top-level screen or setup. A deeper screen opened straight from outside (a shared link, a share
 * from another app) with no history goes to Home first.
 */
export function backActionFor(s: BackState): BackAction {
  if (s.sheetOpen) return 'close-sheet'
  if (s.historyIndex > 0) return 'history-back'
  if (TOP_LEVEL.has(s.path) || s.path.startsWith('/welcome/')) return 'leave'
  return 'go-home'
}

/**
 * Capacitor's names for system bar content: 'DARK' means light icons (for a dark background),
 * 'LIGHT' means dark icons.
 */
export type BarStyle = 'DARK' | 'LIGHT'

export interface BarState {
  /** The page shows its dark theme (pinned in Settings, or the system's). */
  dark: boolean
  /** Setup's night field fills the screen (dark in both themes). */
  darkField: boolean
  /** The sheet has scrolled up under the transparent status bar (layout/statusArea.ts). */
  sheetUnder?: boolean
}

/**
 * Both bars are transparent and the page runs under them. The status bar's icons follow what is
 * under them: light over the blue hero and setup's night field, dark once the light sheet has
 * scrolled under (in the dark theme the sheet is dark, so they stay light). The navigation bar
 * sits over the sheet: dark icons on the light sheet, light icons in the dark theme and on setup.
 */
export function barStylesFor(s: BarState): { status: BarStyle; navigation: BarStyle } {
  const lightBehindStatus = !s.dark && !s.darkField && s.sheetUnder === true
  return { status: lightBehindStatus ? 'LIGHT' : 'DARK', navigation: s.dark || s.darkField ? 'DARK' : 'LIGHT' }
}

/** Reads what the SharedText plugin returned: only string fields and a positive whole share number, nothing else. */
export function sharedTextFrom(value: unknown): { title?: string; text?: string; seq?: number } | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const out: { title?: string; text?: string; seq?: number } = {}
  if (typeof v.title === 'string' && v.title.trim()) out.title = v.title
  if (typeof v.text === 'string' && v.text.trim()) out.text = v.text
  if (out.title === undefined && out.text === undefined) return null
  if (typeof v.seq === 'number' && Number.isSafeInteger(v.seq) && v.seq > 0) out.seq = v.seq
  return out
}
