// Share target and deep link capture (PRD FR-7 to FR-9). Pure functions:
// they turn untrusted `{title, text, url, image, price, currency}` strings
// into a draft the Add Item form can show.

import { LIMITS } from '../model/limits.ts'
import { isSafeHttpUrl } from '../model/guards.ts'
import type { Money } from '../model/types.ts'

export interface CaptureInput {
  title?: string | null
  text?: string | null
  url?: string | null
  image?: string | null
  price?: string | null
  currency?: string | null
}

export interface DraftItem {
  title: string
  url?: string
  imageUrl?: string
  price?: Money
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/i
/** Punctuation that usually ends a sentence rather than a URL. */
const TRAILING_PUNCT = /[),.;:!?\]}>]+$/

function truncate(s: string, max: number): string {
  const cps = Array.from(s)
  return cps.length > max ? cps.slice(0, max).join('') : s
}

/** First http(s) URL in a string, trimmed of trailing punctuation; `undefined` if none or invalid. */
export function findFirstHttpUrl(text: string | null | undefined): string | undefined {
  if (!text) return undefined
  const m = URL_RE.exec(text)
  if (!m) return undefined
  let candidate = m[0]
  // Keep a closing parenthesis that balances one inside the URL (Wikipedia style).
  while (TRAILING_PUNCT.test(candidate)) {
    const last = candidate.at(-1)
    if (last === ')' && (candidate.match(/\(/g)?.length ?? 0) >= (candidate.match(/\)/g)?.length ?? 0)) break
    candidate = candidate.slice(0, -1)
  }
  if (candidate.length > LIMITS.url || !isSafeHttpUrl(candidate)) return undefined
  return candidate
}

/**
 * Query parameters that only identify a campaign, click or mail-out. They are
 * removed from captured links because a published wish shows its link to
 * givers. Anything else is kept: product ids and variants often live in the
 * query string.
 */
export const TRACKING_PARAMS: readonly string[] = [
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'gad_source',
  'msclkid',
  'yclid',
  'ttclid',
  'twclid',
  'igshid',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  'oly_anon_id',
  'oly_enc_id',
  'vero_id',
  'srsltid',
  '_ga',
  '_gl',
]
const TRACKING_SET = new Set(TRACKING_PARAMS)

/** True for a query parameter name that is a well-known tracking parameter (`utm_*`, `fbclid`, `gclid`, ...). */
export function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase()
  return n.startsWith('utm_') || TRACKING_SET.has(n)
}

/**
 * Removes well-known tracking parameters and a text fragment (`#:~:text=`)
 * from an http(s) URL. Other parameters and fragments are kept. Returns the
 * input unchanged when it is not a URL or nothing needs removing.
 */
export function stripTrackingParams(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  let changed = false
  for (const key of [...new Set(u.searchParams.keys())]) {
    if (isTrackingParam(key)) {
      u.searchParams.delete(key)
      changed = true
    }
  }
  if (u.hash.startsWith('#:~:')) {
    u.hash = ''
    changed = true
  }
  if (!changed) return url
  // Drop a dangling "?" left by removing every parameter.
  return u.href.replace(/\?(?=#|$)/, '')
}

const NOISE_SEGMENTS = new Set(['dp', 'gp', 'product', 'products', 'p', 'item', 'items', 'itm', 'ip', 'shop', 'buy', 'pd', 'en', 'us', 'uk', 'de', 'fr', 'html', 'index', 'www'])

function looksLikeId(segment: string): boolean {
  return /^[0-9]+$/.test(segment) || /^[A-Z0-9]{8,}$/.test(segment) || /^[0-9a-f-]{16,}$/i.test(segment)
}

function titleCase(words: string[]): string {
  const s = words.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** A readable title from a product URL, e.g. `/p/red-wool-scarf-12345.html` -> "Red wool scarf". */
export function guessTitleFromUrl(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return ''
  }
  const segments = u.pathname
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
    .map((s) => s.replace(/\.(html?|php|aspx?|jsp)$/i, ''))
    .filter((s) => s.length > 0)
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i] ?? ''
    if (NOISE_SEGMENTS.has(seg.toLowerCase()) || looksLikeId(seg)) continue
    const words = seg
      .split(/[-_+\s]+/)
      .filter((w) => w.length > 0 && !looksLikeId(w))
    const letters = words.join('').replace(/[^\p{L}]/gu, '')
    if (words.length === 0 || letters.length < 3) continue
    return truncate(titleCase(words.map((w) => w.toLowerCase())), LIMITS.title)
  }
  const host = u.hostname.replace(/^www\./, '')
  return truncate(host, LIMITS.title)
}

const SYMBOLS: ReadonlyArray<[string, string]> = [
  ['US$', 'USD'],
  ['CA$', 'CAD'],
  ['A$', 'AUD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['¥', 'JPY'],
  ['₹', 'INR'],
  ['₩', 'KRW'],
  ['CHF', 'CHF'],
  ['kr', 'SEK'],
  ['zł', 'PLN'],
  ['$', 'USD'],
]

/** Minor-unit digits for a currency (JPY 0, EUR 2, KWD 3); `undefined` for unknown codes. */
export function currencyDigits(currency: string): number | undefined {
  if (!/^[A-Z]{3}$/.test(currency)) return undefined
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits
  } catch {
    return undefined
  }
}

/**
 * Parses a human price string into minor units without floating-point
 * arithmetic. Handles "1,234.56", "1.234,56", "1 234,50 €", "$12", "12.5".
 * A separator followed by exactly three digits is a thousands separator.
 * Returns `undefined` rather than guessing when the string is ambiguous,
 * negative, has more decimals than the currency allows, or is too large.
 */
export function parsePrice(input: string | null | undefined, currency?: string | null): Money | undefined {
  if (!input) return undefined
  let s = input.trim()
  if (s.length === 0 || s.length > 40 || s.includes('-')) return undefined

  let code = currency?.trim().toUpperCase() || undefined
  const isoInText = /\b([A-Z]{3})\b/.exec(s.toUpperCase())
  if (isoInText?.[1] && currencyDigits(isoInText[1]) !== undefined) {
    code ??= isoInText[1]
    s = s.replace(new RegExp(`\\b${isoInText[1]}\\b`, 'i'), '')
  }
  for (const [sym, iso] of SYMBOLS) {
    if (s.includes(sym)) {
      code ??= iso
      s = s.split(sym).join('')
    }
  }
  if (!code) return undefined
  const digits = currencyDigits(code)
  if (digits === undefined) return undefined

  s = s.replace(/[\s  ']/g, '')
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return undefined

  let intPart = s
  let fracPart = ''
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  const decimalSep = (() => {
    if (lastDot >= 0 && lastComma >= 0) return lastDot > lastComma ? '.' : ','
    const sep = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null
    if (sep === null) return null
    const count = s.split(sep).length - 1
    const after = s.length - s.lastIndexOf(sep) - 1
    if (count > 1) return null
    if (after === 3 && digits !== 3) return null
    return sep
  })()
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep)
    intPart = s.slice(0, idx)
    fracPart = s.slice(idx + 1)
  }
  const thousandsSep = decimalSep === '.' ? ',' : decimalSep === ',' ? '.' : null
  // Validate thousands grouping instead of just deleting separators.
  if (/[.,]/.test(intPart)) {
    const groups = thousandsSep ? intPart.split(thousandsSep) : intPart.split(/[.,]/)
    if (thousandsSep && /[.,]/.test(groups.join(''))) return undefined
    if (groups.some((g, i) => (i === 0 ? g.length < 1 || g.length > 3 : g.length !== 3))) return undefined
    intPart = groups.join('')
  }
  if (!/^[0-9]*$/.test(intPart) || !/^[0-9]*$/.test(fracPart)) return undefined
  if (fracPart.length > digits) return undefined
  if (intPart.length === 0 && fracPart.length === 0) return undefined
  if (intPart.length > 13) return undefined
  const amount = Number(intPart || '0') * 10 ** digits + Number(fracPart.padEnd(digits, '0') || '0')
  if (!Number.isSafeInteger(amount) || amount > LIMITS.amount) return undefined
  return { amount, currency: code }
}

function cleanText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

/** Builds a draft item from share-target or deep-link parameters. */
export function draftFromCapture(input: CaptureInput): DraftItem {
  const found = findFirstHttpUrl(input.url) ?? findFirstHttpUrl(input.text)
  const url = found === undefined ? undefined : stripTrackingParams(found)
  let title = cleanText(input.title)
  if (!title) {
    const textWithoutUrl = cleanText((input.text ?? '').replace(URL_RE, ' '))
    title = url ? guessTitleFromUrl(url) : ''
    if (!title) title = textWithoutUrl
  }
  const draft: DraftItem = { title: truncate(title, LIMITS.title) }
  if (url) draft.url = url
  const image = findFirstHttpUrl(input.image)
  if (image) draft.imageUrl = image
  const price = parsePrice(input.price, input.currency)
  if (price) draft.price = price
  return draft
}

/** Reads FR-9 deep link parameters (`?title=&text=&url=&image=&price=&currency=`). */
export function captureFromSearchParams(params: URLSearchParams | string): CaptureInput | null {
  const p = typeof params === 'string' ? new URLSearchParams(params) : params
  const keys = ['title', 'text', 'url', 'image', 'price', 'currency'] as const
  const out: CaptureInput = {}
  let any = false
  for (const k of keys) {
    const v = p.get(k)
    if (v !== null && v.trim() !== '') {
      out[k] = v.slice(0, LIMITS.url * 2)
      any = true
    }
  }
  return any ? out : null
}
