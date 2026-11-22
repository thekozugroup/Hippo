/**
 * Safe money formatting for the UI. Amounts and currency codes can come from shared lists
 * written by other people, so nothing here throws: a bad currency code falls back to a plain
 * number followed by the code as text, and a non-finite amount renders as a dash.
 */

export interface MoneyPart {
  type: string
  value: string
}

const formatters = new Map<string, Intl.NumberFormat | null>()

function cached(key: string, make: () => Intl.NumberFormat): Intl.NumberFormat | null {
  if (formatters.has(key)) return formatters.get(key) ?? null
  let fmt: Intl.NumberFormat | null
  try {
    fmt = make()
  } catch {
    fmt = null
  }
  if (formatters.size > 200) formatters.clear()
  formatters.set(key, fmt)
  return fmt
}

/** A code that is safe to show as text: trimmed, no control characters, short. */
export function safeCode(code: unknown): string {
  const text = typeof code === 'string' ? code : ''
  return [...text]
    .filter((c) => {
      const n = c.charCodeAt(0)
      return n > 31 && n !== 127
    })
    .join('')
    .trim()
    .slice(0, 8)
}

function currencyFormat(currency: string, locale: string | undefined, whole: boolean): Intl.NumberFormat | null {
  const opts = whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}
  const withLocale = cached(`c|${locale ?? ''}|${currency}|${whole}`, () => new Intl.NumberFormat(locale, { style: 'currency', currency, ...opts }))
  if (withLocale || locale === undefined) return withLocale
  // An invalid locale tag must not break the currency either.
  return cached(`c||${currency}|${whole}`, () => new Intl.NumberFormat(undefined, { style: 'currency', currency, ...opts }))
}

function plainFormat(locale: string | undefined): Intl.NumberFormat {
  const fmt = cached(`p|${locale ?? ''}`, () => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })) ?? cached('p|', () => new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  // The last resort cannot fail for the default locale, but keep the type honest.
  return fmt ?? new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Formats an amount in minor units (cents) as parts. Never throws. */
export function moneyParts(amount: number, currency: string, locale?: string, compact = false): MoneyPart[] {
  const code = safeCode(currency)
  if (!Number.isFinite(amount)) return [{ type: 'literal', value: '—' }, ...(code ? [{ type: 'literal', value: ' ' }, { type: 'currency', value: code }] : [])]
  const probe = currencyFormat(code, locale, false)
  if (!probe) {
    // Unknown or malformed code: plain number, code as text.
    const major = amount / 100
    return [...plainFormat(locale).formatToParts(major), ...(code ? [{ type: 'literal', value: ' ' }, { type: 'currency', value: code }] : [])]
  }
  const digits = probe.resolvedOptions().maximumFractionDigits ?? 2
  const major = amount / 10 ** digits
  const whole = compact && Number.isInteger(major)
  const fmt = (whole ? currencyFormat(code, locale, true) : probe) ?? probe
  return fmt.formatToParts(major)
}

/** Currency symbol for a prefix, or the code itself when unknown. Never throws. */
export function currencySymbol(currency: string, locale?: string): string {
  const code = safeCode(currency)
  const fmt = currencyFormat(code, locale, false)
  if (!fmt) return code
  const part = fmt.formatToParts(0).find((p) => p.type === 'currency')
  return part?.value ?? code
}

/** Spoken name of the currency ("US dollars"), falling back to the code. Never throws. */
export function currencyName(currency: string, locale?: string): string {
  const code = safeCode(currency)
  try {
    return new Intl.DisplayNames(locale, { type: 'currency' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}
