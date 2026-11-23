// Native HTTP for the app: reading a shop page (through the app's PageFetch
// plugin, which caps the size, sends no cookies and checks every redirect),
// and the HEAD request the corrected clock uses (Capacitor's CapacitorHttp).

import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { lookupPageOnDevice, PageFetchError, type FetchedPage, type HippoDb, type LinkPreviewResult, type PageFetchErrorCode } from '../../core/index.ts'
import { PageFetch } from './plugins.ts'

function errorCode(e: unknown): PageFetchErrorCode {
  const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: unknown }).code : undefined
  return code === 'blocked' || code === 'timeout' ? code : 'network'
}

/** The native page fetch as core's `PageFetcher`. */
export async function fetchPage(url: string, options: { timeoutMs: number; maxBytes: number }): Promise<FetchedPage> {
  try {
    return await PageFetch.fetch({ url, timeoutMs: options.timeoutMs, maxBytes: options.maxBytes })
  } catch (e) {
    throw new PageFetchError(errorCode(e))
  }
}

export function lookupShopPage(url: string, deps: { db: HippoDb; signal?: AbortSignal }): Promise<LinkPreviewResult> {
  return lookupPageOnDevice(url, { db: deps.db, fetchPage, ...(deps.signal ? { signal: deps.signal } : {}) })
}

/**
 * A HEAD request to the public website for its `Date` header (core `TimeSync`). Redirects are not
 * followed (a redirect still carries the header). Throws when there is no answer, and TimeSync
 * then keeps the device clock.
 */
export async function headForDate(input: string): Promise<Pick<Response, 'headers'>> {
  // Without the Android bridge CapacitorHttp would fall back to the page's fetch, which the app's
  // content policy blocks for other hosts. Fail instead; TimeSync then keeps the device clock.
  if (!Capacitor.isNativePlatform()) throw new Error('No native HTTP here.')
  const res = await CapacitorHttp.request({
    url: input,
    method: 'HEAD',
    connectTimeout: 5_000,
    readTimeout: 5_000,
    disableRedirects: true,
    headers: { 'Cache-Control': 'no-store' },
  })
  const headers = new Headers()
  for (const [name, value] of Object.entries(res.headers ?? {})) {
    if (typeof value === 'string') headers.set(name, value)
  }
  return { headers }
}
