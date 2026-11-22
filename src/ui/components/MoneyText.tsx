import { cx } from '../cx.ts'
import { moneyParts } from './money.ts'
import './MoneyText.css'

/** An amount in minor units (for example cents) and its ISO 4217 currency code. */
export interface MoneyLike {
  amount: number
  currency: string
}

export interface MoneyTextProps {
  /** The amount in minor units and its currency. Unknown codes and non-finite amounts never throw. */
  money: MoneyLike
  /** BCP 47 locale; defaults to the runtime locale. */
  locale?: string | undefined
  /** Render the decimals in the muted tone (the `$117,450` + `.17` pattern). */
  muteFraction?: boolean
  /** Drop the decimals when the amount is a whole number. */
  compact?: boolean
  className?: string
}

/** Formats money with `Intl.NumberFormat`; falls back to a plain number plus the code when the currency is unknown. */
export function MoneyText({ money, locale, muteFraction, compact, className }: MoneyTextProps) {
  const parts = moneyParts(money.amount, money.currency, locale, compact)
  if (!muteFraction) {
    return <span className={cx('money', className)}>{parts.map((p) => p.value).join('')}</span>
  }
  return (
    <span className={cx('money', className)}>
      {parts.map((part, i) =>
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
