import { cx } from '../cx.ts'
import './MoneyText.css'

/** Money in integer minor units plus an ISO 4217 code (same shape as the protocol's `Money`). */
export interface MoneyLike {
  amount: number
  currency: string
}

export interface MoneyTextProps {
  /** The amount to format. */
  money: MoneyLike
  /** BCP 47 locale; defaults to the browser's. */
  locale?: string | undefined
  /** Render the fraction digits in a lighter colour (only inside `BigValue` or when styled). */
  muteFraction?: boolean
  /** Hide the fraction when it is zero ($40 instead of $40.00). */
  compact?: boolean
  className?: string
}

/** Formats a `Money` with `Intl.NumberFormat`. */
export function MoneyText({ money, locale, muteFraction, compact, className }: MoneyTextProps) {
  const digits = new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }).resolvedOptions().maximumFractionDigits ?? 2
  const major = money.amount / 10 ** digits
  const whole = compact && Number.isInteger(major)
  const fmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
  })
  if (!muteFraction) return <span className={cx('money', className)}>{fmt.format(major)}</span>
  return (
    <span className={cx('money', className)}>
      {fmt.formatToParts(major).map((part, i) =>
        part.type === 'fraction' || part.type === 'decimal' ? (
          <span key={i} className="money__fraction">
            {part.value}
          </span>
        ) : (
          part.value
        ),
      )}
    </span>
  )
}
