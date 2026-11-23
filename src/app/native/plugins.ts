// The app's own small Capacitor plugins (Java, in
// android/app/src/main/java/io/github/thekozugroup/hippo/). Loaded only
// inside the app, through dynamic imports from index.ts.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { FetchedPage } from '../../core/index.ts'

/** Text another app shared with Hippo (Android ACTION_SEND, text/plain). Both fields are capped in Java; treat them as untrusted. */
export interface SharedTextData {
  title?: string
  text?: string
}

export interface SharedTextPlugin {
  /** Returns the share waiting to be used and forgets it (an empty object when there is none). */
  take(): Promise<SharedTextData>
  /** Fires when a share arrives while the app runs; call `take` to read it. */
  addListener(event: 'received', listener: () => void): Promise<PluginListenerHandle>
}

export interface PageFetchPlugin {
  /** Fetches an https page from a public host (re-checked after each redirect), without cookies, capped at `maxBytes`. Rejects with code `blocked`, `timeout` or `network`. */
  fetch(options: { url: string; timeoutMs: number; maxBytes: number }): Promise<FetchedPage>
}

export interface TouchFeedbackPlugin {
  /** One haptic tap through the view, which follows the system's touch feedback setting. */
  perform(options: { kind: 'confirm' | 'toggle' | 'warning' }): Promise<void>
}

export const SharedText = registerPlugin<SharedTextPlugin>('SharedText')
export const PageFetch = registerPlugin<PageFetchPlugin>('PageFetch')
export const TouchFeedback = registerPlugin<TouchFeedbackPlugin>('TouchFeedback')
