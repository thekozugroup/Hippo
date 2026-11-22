import { useId } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import { FieldShell } from './Field.tsx'
import { describedBy } from './describedBy.ts'

export interface MoneyFieldProps extends Omit<ComponentPropsWithoutRef<'input'>, 'id' | 'type' | 'inputMode'> {
  /** Visible label above the field. */
  label: string
  /** ISO 4217 code; its symbol is shown as a prefix. */
  currency: string
  /** BCP 47 locale for the symbol. */
  locale?: string
  /** Helper text under the field. */
  hint?: string
  /** Error text; marks the field invalid. */
  error?: string
  /** Optional id; generated when omitted. */
  id?: string
}

function symbolFor(currency: string, locale?: string): string {
  const part = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
    .formatToParts(0)
    .find((p) => p.type === 'currency')
  return part?.value ?? currency
}

/** Decimal text field with a currency symbol prefix; the value stays a string for the caller to parse. */
export function MoneyField({ label, currency, locale, hint, error, id, className, ...rest }: MoneyFieldProps) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} className={className}>
      <div className="field__control">
        <span className="field__prefix" aria-hidden="true">
          {symbolFor(currency, locale)}
        </span>
        <input
          {...rest}
          id={fid}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fid, hint, error)}
        />
      </div>
    </FieldShell>
  )
}
