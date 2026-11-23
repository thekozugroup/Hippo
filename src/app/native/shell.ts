// The Android app shell: everything that makes the WebView behave like an
// app. Loaded once, after the first render is queued (index.ts,
// startNativeShell), and only inside the app.
//
// - Back button and predictive back: close an open sheet, then go back in
//   history, then leave from a top-level screen (logic.ts). While Back would
//   leave, the app hands it to Android, so the system's own back-to-home
//   animation plays.
// - System bars (Capacitor's SystemBars): light status bar icons over the hero,
//   navigation bar icons that follow the theme and setup's night field.
// - Share target: text shared from another app opens Add a wish (capture.ts).
// - Links to the public website that Android opens in the app go to the list.
// - Keyboard: html[data-keyboard] while it is open, so the floating navigation
//   steps aside.
// - Foreground again: retry pending sync and check the clock.
// - Splash: hidden once the first screen has painted.

import { App } from '@capacitor/app'
import { SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { SplashScreen } from '@capacitor/splash-screen'
import { captureShared } from '../core/capture.ts'
import { appResumed } from '../core/core.ts'
import { historyIndex, navigate } from '../layout/motionLocation.ts'
import { payloadFromSiteLink, PUBLIC_SITE_URL } from '../lib/site-address.ts'
import { wireFeedback } from './feedback.ts'
import { backActionFor, barStylesFor, sharedTextFrom, type BarStyle } from './logic.ts'
import { SharedText } from './plugins.ts'
import { clearBackupFiles } from './share.ts'

let started = false

/** Registers a plugin listener; a plugin that is missing or fails must not break the app. */
function listen(register: () => Promise<unknown>): void {
  try {
    void register().catch(() => undefined)
  } catch {
    // Not available here.
  }
}

function hashPath(): string {
  const raw = window.location.hash.replace(/^#/, '')
  const path = raw.split('?')[0] ?? ''
  return path === '' ? '/' : path
}

function openSheet(): HTMLDialogElement | null {
  const open = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'))
  return open.at(-1) ?? null
}

// ------------------------------------------------------------------ back

function backState() {
  return { sheetOpen: openSheet() !== null, historyIndex: historyIndex(), path: hashPath() }
}

let handlerEnabled: boolean | undefined

/** Keeps the app's Back handler on only while Back has something to do inside the app. */
function syncBackHandler(): void {
  const enabled = backActionFor(backState()) !== 'leave'
  if (enabled === handlerEnabled) return
  handlerEnabled = enabled
  void App.toggleBackButtonHandler({ enabled }).catch(() => undefined)
}

function onBack(): void {
  const action = backActionFor(backState())
  if (action === 'close-sheet') {
    // BottomSheet hears the dialog's close event and updates its owner's state.
    const sheet = openSheet()
    if (sheet && typeof sheet.close === 'function') sheet.close()
  }
  else if (action === 'history-back') window.history.back()
  else if (action === 'go-home') navigate('/', { replace: true })
  else void App.minimizeApp().catch(() => undefined)
}

function wireBack(): void {
  listen(() => App.addListener('backButton', onBack))
  window.addEventListener('hashchange', syncBackHandler)
  window.addEventListener('popstate', syncBackHandler)
  // Sheets open and close without a route change.
  new MutationObserver(syncBackHandler).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'], childList: true })
  syncBackHandler()
}

// ------------------------------------------------------------------ system bars

const applied: { status?: BarStyle; navigation?: BarStyle } = {}

function pageIsDark(): boolean {
  const pinned = document.documentElement.dataset.theme
  if (pinned === 'dark' || pinned === 'light') return pinned === 'dark'
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

function syncBars(): void {
  const root = document.documentElement
  const darkField = hashPath().startsWith('/welcome/') || root.dataset.boot === 'setup'
  if (darkField !== (root.dataset.field === 'night')) {
    if (darkField) root.dataset.field = 'night'
    else delete root.dataset.field
  }
  const want = barStylesFor({ dark: pageIsDark(), darkField })
  if (want.status !== applied.status) {
    applied.status = want.status
    void SystemBars.setStyle({ style: want.status === 'DARK' ? SystemBarsStyle.Dark : SystemBarsStyle.Light, bar: SystemBarType.StatusBar }).catch(() => undefined)
  }
  if (want.navigation !== applied.navigation) {
    applied.navigation = want.navigation
    void SystemBars.setStyle({ style: want.navigation === 'DARK' ? SystemBarsStyle.Dark : SystemBarsStyle.Light, bar: SystemBarType.NavigationBar }).catch(() => undefined)
  }
}

function wireBars(): void {
  new MutationObserver(syncBars).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-boot'] })
  window.addEventListener('hashchange', syncBars)
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncBars)
  syncBars()
  // The status bar backdrop (base.css, html[data-native]) shows once the page scrolls under it.
  const root = document.documentElement
  const onScroll = () => {
    const scrolled = window.scrollY > 4
    if (scrolled !== ('scrolled' in root.dataset)) {
      if (scrolled) root.dataset.scrolled = ''
      else delete root.dataset.scrolled
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
}

// ------------------------------------------------------------------ shares and links

async function takeShare(): Promise<void> {
  let shared: unknown
  try {
    shared = await SharedText.take()
  } catch {
    return
  }
  const text = sharedTextFrom(shared)
  if (!text) return
  if (captureShared(text)) navigate('/item/new')
}

/** A link Android opened in the app. Only share links of the public website are followed; the link itself is never logged. */
function openLink(url: unknown): void {
  if (typeof url !== 'string') return
  const payload = payloadFromSiteLink(url, PUBLIC_SITE_URL)
  if (payload) navigate(`/l/${payload}`)
}

function wireIncoming(): void {
  listen(() => SharedText.addListener('received', () => void takeShare()))
  void takeShare()
  // Also covers the link that started the app: Capacitor hands the launch intent to the plugin,
  // which keeps the event until this listener is added.
  listen(() => App.addListener('appUrlOpen', (e) => openLink(e.url)))
}

// ------------------------------------------------------------------ keyboard, foreground, splash

function wireKeyboard(): void {
  const root = document.documentElement
  listen(() =>
    Keyboard.addListener('keyboardWillShow', () => {
      root.dataset.keyboard = ''
    }),
  )
  listen(() =>
    Keyboard.addListener('keyboardWillHide', () => {
      delete root.dataset.keyboard
    }),
  )
}

function wireForeground(): void {
  listen(() =>
    App.addListener('resume', () => {
      appResumed()
      syncBars()
    }),
  )
}

function hideSplash(): void {
  // Two frames: the first screen has been laid out and painted.
  requestAnimationFrame(() => requestAnimationFrame(() => void SplashScreen.hide({ fadeOutDuration: 150 }).catch(() => undefined)))
}

export function startShell(): void {
  if (started) return
  started = true
  wireBars()
  wireBack()
  wireIncoming()
  wireKeyboard()
  wireForeground()
  wireFeedback()
  void clearBackupFiles()
  hideSplash()
}
