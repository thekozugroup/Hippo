// The Android app shell: everything that makes the WebView behave like an
// app. Loaded once, after the first render is queued (index.ts,
// startNativeShell), and only inside the app.
//
// - Back button and predictive back: close an open sheet, then go back in
//   history, then leave from a top-level screen (logic.ts). While Back would
//   leave, the app hands it to Android, so the system's own back-to-home
//   animation plays.
// - System bars (Capacitor's SystemBars): both transparent; status bar icons
//   light over the hero and dark once the light sheet is under them, navigation
//   bar icons that follow the theme and setup's night field.
// - Share target: text shared from another app opens Add a wish (capture.ts).
// - Links to the public website that Android opens in the app go to the list, and "Open in the
//   Hippo app" from a browser (hippo://open/<route>) goes to its validated route.
// - Keyboard: html[data-keyboard] while it is open, so the floating navigation
//   steps aside.
// - Foreground again: retry pending sync and check the clock.
// - Splash: hidden once the first screen has painted.

import { App } from '@capacitor/app'
import { SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { SplashScreen } from '@capacitor/splash-screen'
import { captureShared } from '../core/capture.ts'
import { appRouteFromOpenUrl, type AppRoute } from '../lib/app-route.ts'
import { appResumed } from '../core/core.ts'
import { historyIndex, navigate } from '../layout/motionLocation.ts'
import { isSheetUnderStatusBar, onStatusAreaChange } from '../layout/statusArea.ts'
import { payloadFromSiteLink, PUBLIC_SITE_URL, siteAddress, transferPayloadFromSiteLink } from '../lib/site-address.ts'
import { holdTransferPayload, transferPayloadInText } from '../lib/transfer-inbox.ts'
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
  const darkField = hashPath().startsWith('/welcome/') || hashPath() === '/existing' || root.dataset.boot === 'setup'
  if (darkField !== (root.dataset.field === 'night')) {
    if (darkField) root.dataset.field = 'night'
    else delete root.dataset.field
  }
  const want = barStylesFor({ dark: pageIsDark(), darkField, sheetUnder: isSheetUnderStatusBar() })
  if (want.status !== applied.status) {
    applied.status = want.status
    // What the app asked Android for, readable by the emulator check (scripts/android-webview-checks.mjs).
    root.dataset.statusIcons = want.status === 'DARK' ? 'light' : 'dark'
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
  // The status bar icons follow what is under them (layout/statusArea.ts decides, with hysteresis).
  onStatusAreaChange(syncBars)
  syncBars()
}

// ------------------------------------------------------------------ shares and links

/** The number of the latest share used; an older answer (two shares in quick succession) is ignored. */
let lastShareSeq = 0

/**
 * Takes the share the SharedText plugin holds, if any, and opens it: a transfer link goes to the
 * transfer import, anything else to Add a wish through captureShared (the same checks as a deep
 * link). Called at start (a share that started the app, held by the plugin until now) and on every
 * "received" (a share while the app runs, in the foreground or the background).
 */
async function takeShare(): Promise<void> {
  let shared: unknown
  try {
    shared = await SharedText.take()
  } catch {
    return
  }
  const text = sharedTextFrom(shared)
  if (!text) return
  if (text.seq !== undefined) {
    if (text.seq <= lastShareSeq) return
    lastShareSeq = text.seq
  }
  // A transfer link shared from another app (a chat): receive it, never as a wish.
  const transfer = transferPayloadInText(`${text.title ?? ''} ${text.text ?? ''}`)
  if (transfer) {
    holdTransferPayload(transfer)
    navigate('/move/receive')
    return
  }
  if (captureShared(text)) navigate('/item/new')
}

/**
 * "Open in the Hippo app" from a browser (`hippo://open/<route>`, see lib/app-route.ts): the one
 * validated way in. A list or transfer payload is handled as for a link (it leaves the address and
 * history at once); anything not on the list opens Home.
 */
function openAppRoute(route: AppRoute): void {
  if (route.kind === 'list') navigate(`/l/${route.payload}`)
  else if (route.kind === 'transfer') {
    holdTransferPayload(route.payload)
    navigate('/move/receive')
  } else navigate(route.path)
}

/** A link Android opened in the app. Only Hippo's own scheme and share links of the public website are followed; the link itself is never logged. */
function openLink(url: unknown): void {
  const route = appRouteFromOpenUrl(url)
  if (route) {
    openAppRoute(route)
    return
  }
  if (typeof url !== 'string') return
  for (const site of new Set([siteAddress(), PUBLIC_SITE_URL])) {
    const payload = payloadFromSiteLink(url, site)
    if (payload) {
      navigate(`/l/${payload}`)
      return
    }
    // A transfer link: the secret goes straight to the receive screen, never into the address.
    const transfer = transferPayloadFromSiteLink(url, site)
    if (transfer) {
      holdTransferPayload(transfer)
      navigate('/move/receive')
      return
    }
  }
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

/**
 * Hides the splash once the first screen has painted: two frames, or 400 ms if frames do not run
 * while the splash covers the WebView. Then html[data-splash] goes, which lets the logo intro on
 * the first setup step start (LogoIntro waits for it, so it never plays under the splash).
 */
function hideSplash(): void {
  let done = false
  const hide = () => {
    if (done) return
    done = true
    void SplashScreen.hide({ fadeOutDuration: 150 })
      .catch(() => undefined)
      .finally(() => window.setTimeout(() => document.documentElement.removeAttribute('data-splash'), 160))
  }
  requestAnimationFrame(() => requestAnimationFrame(hide))
  window.setTimeout(hide, 400)
  // Whatever happens to the plugin call, the page is not held back for longer than this.
  window.setTimeout(() => document.documentElement.removeAttribute('data-splash'), 2500)
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
