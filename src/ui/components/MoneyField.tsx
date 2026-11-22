import { useId } from 'react'
import type { ComponentPropsWithRef } from 'react'
import { FieldShell } from './Field.tsx'
import { describedBy, invalidState } from './describedBy.ts'
import { currencyName, currencySymbol } from './money.ts'

export interface MoneyFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'id' | 'type' | 'inputMode'> {
  /** Visible label above the field. */
  label: string
  /** ISO 4217 code; its symbol is shown as a prefix and its name is announced as a description. */
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

/** Amount field with a currency prefix. An unknown code is shown as text instead of throwing. */
export function MoneyField({ label, currency, locale, hint, error, id, className, ...rest }: MoneyFieldProps) {
  const auto = useId()
  const fid = id ?? auto
  const curId = `${fid}-currency`
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} className={className}>
      <div className="field__control">
        <span className="field__prefix" aria-hidden="true">
          {currencySymbol(currency, locale)}
        </span>
        <span className="sr-only" id={curId}>
          {currencyName(currency, locale)}
        </span>
        <input
          {...rest}
          id={fid}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="field__input"
          aria-invalid={invalidState(error, rest['aria-invalid'])}
          aria-describedby={describedBy(fid, hint, error, [curId, rest['aria-describedby']].filter(Boolean).join(' '))}
        />
      </div>
    </FieldShell>
  )
}
