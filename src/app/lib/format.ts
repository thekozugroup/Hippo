// Small pure helpers shared by the screens.

import { currencyDigits, isSafeHttpUrl, parsePrice } from '../../core/index.ts'
import type { Importance, Money, PublishResult, SharedList, SyncReport } from '../../core/index.ts'

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  nice: 'Nice to have',
  want: 'Want',
  love: 'Would love',
}

export function importanceLevel(i: Importance): 1 | 2 | 3 {
  return i === 'nice' ? 1 : i === 'want' ? 2 : 3
}

/** Currencies offered in the item editor; others still display fine. */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'JPY', 'INR'] as const

/** "Sat, 24 Dec 2026" for a YYYY-MM-DD date, without time-zone drift. */
export function formatEventDate(date: string, locale?: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  )
}

/** "today", "yesterday", "3 days ago" for a timestamp. */
export function formatAdded(ts: number, now = Date.now(), locale?: string): string {
  const day = 24 * 60 * 60 * 1000
  const days = Math.floor((startOfDay(now) - startOfDay(ts)) / day)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (days < 7) return rtf.format(-days, 'day')
  if (days < 60) return rtf.format(-Math.floor(days / 7), 'week')
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(ts)
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Formats money as plain text, for sentences and accessible values. */
export function moneyText(money: Money, locale?: string): string {
  const digits = currencyDigits(money.currency) ?? 2
  return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }).format(money.amount / 10 ** digits)
}

/** The editable text for an amount, e.g. 2490 USD -> "24.90". */
export function moneyInputValue(money: Money | undefined): string {
  if (!money) return ''
  const digits = currencyDigits(money.currency) ?? 2
  const s = String(money.amount).padStart(digits + 1, '0')
  return digits === 0 ? s : `${s.slice(0, -digits)}.${s.slice(-digits)}`
}

/**
 * Parses what someone typed into a money field. Empty input is `null`;
 * anything that is not a clear positive amount is `undefined`.
 */
export function parseMoneyInput(input: string, currency: string): Money | null | undefined {
  const s = input.trim()
  if (s === '') return null
  const m = parsePrice(s, currency)
  if (!m || m.currency !== currency || m.amount <= 0) return undefined
  return m
}

/** An http(s) URL that may be used as a link or image source, else undefined. */
export function safeUrl(url: string | undefined | null): string | undefined {
  return url && isSafeHttpUrl(url) ? url : undefined
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export interface ServerResult {
  relay: string
  ok: boolean
  message?: string
}

export interface SyncSummary {
  /** Servers that accepted every event that was sent. */
  accepted: number
  total: number
  servers: ServerResult[]
  /** Nothing needed sending. */
  empty: boolean
}

/** Per-server outcome across one or more sync reports. */
export function summariseSync(reports: ReadonlyArray<SyncReport | { events: ReadonlyArray<{ result: PublishResult }> }>): SyncSummary {
  const byRelay = new Map<string, ServerResult>()
  let events = 0
  for (const r of reports) {
    for (const e of r.events) {
      events++
      for (const rr of e.result.relays) {
        const prev = byRelay.get(rr.relay)
        if (!prev) {
          const entry: ServerResult = { relay: rr.relay, ok: rr.ok }
          if (!rr.ok && rr.message) entry.message = rr.message
          byRelay.set(rr.relay, entry)
        } else if (!rr.ok && prev.ok) {
          prev.ok = false
          if (rr.message) prev.message = rr.message
        }
      }
    }
  }
  const servers = [...byRelay.values()]
  return { accepted: servers.filter((s) => s.ok).length, total: servers.length, servers, empty: events === 0 }
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Plain words for an owned list's sharing state. A published list no relay has accepted yet is not shared yet. */
export function listStatusLabel(list: Pick<SharedList, 'status' | 'linkPending'>): string {
  if (list.status === 'published') return list.linkPending ? 'Not shared yet' : 'Shared'
  if (list.status === 'draft') return 'Not shared yet'
  return 'Sharing stopped'
}
