// The Android app's native features behind one small interface. The rest of
// the app imports only this file (and platform.ts); every function here is a
// no-op or a web fallback on the website.
//
// Plugin code lives in the sibling modules (shell.ts, share.ts, http.ts,
// feedback.ts, plugins.ts) and is loaded with dynamic imports, each behind
// `__HIPPO_NATIVE__`. That constant is `false` in the website build, so those
// branches and their chunks are dropped there: the website never downloads
// Capacitor code, and the app loads it after the first screen.

import type { HippoDb, LinkPreviewResult } from '../../core/index.ts'
import { isNativeApp } from './platform.ts'

export { isNativeApp, NATIVE_BUILD } from './platform.ts'

/** Starts the app shell: back button, system bars, share target, links, keyboard, splash. Call once, after the first render is queued. */
export function startNativeShell(): void {
  if (!__HIPPO_NATIVE__ || !isNativeApp()) return
  // At once, so the app's styles (base.css, html[data-native]) apply from the first frame.
  document.documentElement.dataset.native = 'android'
  void import('./shell.ts').then((m) => m.startShell()).catch(() => undefined)
}

export type ShareOutcome = 'shared' | 'cancelled' | 'failed'

/** Whether a "Share" button can open the system share sheet: always in the app; on the website when the browser has Web Share. */
export function canShareSheet(): boolean {
  return isNativeApp() || (typeof navigator !== 'undefined' && typeof navigator.share === 'function')
}

/** Opens the system share sheet for a link (Capacitor Share in the app, Web Share on the website). */
export async function shareSheet(data: { title: string; text?: string; url: string }): Promise<ShareOutcome> {
  if (__HIPPO_NATIVE__ && isNativeApp()) return (await import('./share.ts')).shareLink(data)
  try {
    await navigator.share(data)
    return 'shared'
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}

/**
 * Inside the app a backup cannot be downloaded (a WebView has no downloads), so the file is written
 * to the app's private cache and handed to the share sheet ("Save to Files", Drive, email and so on).
 * Returns undefined on the website, where the caller downloads the file as before.
 */
export async function shareBackupFile(fileName: string, json: string): Promise<ShareOutcome | undefined> {
  if (!__HIPPO_NATIVE__ || !isNativeApp()) return undefined
  return (await import('./share.ts')).shareBackup(fileName, json)
}

export type HapticKind = 'confirm' | 'toggle' | 'warning'

/** A light haptic tap in the app, for a few meaningful moments only. Nothing on the website, under reduced motion, or when the system turns touch feedback off. */
export function haptic(kind: HapticKind): void {
  if (!__HIPPO_NATIVE__ || !isNativeApp()) return
  void import('./feedback.ts').then((m) => m.haptic(kind)).catch(() => undefined)
}

/** Reads a shop page's name, picture and price on the device (the app only); `{ kind: 'disabled' }` on the website. */
export async function lookupOnDevice(url: string, deps: { db: HippoDb; signal?: AbortSignal }): Promise<LinkPreviewResult> {
  if (!__HIPPO_NATIVE__ || !isNativeApp()) return { kind: 'disabled' }
  return (await import('./http.ts')).lookupShopPage(url, deps)
}

/** The request the corrected clock uses in the app: a HEAD request through native HTTP (the app's own origin has no server to ask). Undefined on the website. */
export function clockFetch(): ((input: string) => Promise<Pick<Response, 'headers'>>) | undefined {
  if (!__HIPPO_NATIVE__ || !isNativeApp()) return undefined
  return async (input) => (await import('./http.ts')).headForDate(input)
}
