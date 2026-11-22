import { useState, type FormEvent } from 'react'
import { BottomSheet, Button, Checkbox, MoneyField, TextField } from '../../../ui/index.ts'
import { LIMITS, type ClaimActionResult, type ClaimRow, type GiverItemView, type GiverListSession } from '../../../core/index.ts'
import { useNotify } from '../../core/notify.ts'
import { moneyInputValue, moneyText, parseMoneyInput } from '../../lib/format.ts'
import { actionErrorMessage, claimResultMessage } from './giverText.ts'

export type SheetRequest =
  | { mode: 'claim'; view: GiverItemView }
  | { mode: 'pledge'; view: GiverItemView }
  | { mode: 'cover'; view: GiverItemView }
  | { mode: 'edit'; view: GiverItemView; row: ClaimRow }
  | { mode: 'withdraw'; title: string; claimId: string; itemId: string }
  | { mode: 'nickname'; current?: string }

function sheetTitle(r: SheetRequest): string {
  switch (r.mode) {
    case 'claim':
      return 'Get this gift'
    case 'pledge':
      return 'Chip in'
    case 'cover':
      return 'Cover the rest'
    case 'edit':
      return r.row.kind === 'full' ? 'Change how many' : 'Change your amount'
    case 'withdraw':
      return 'Take this back?'
    case 'nickname':
      return 'Your name on this list'
  }
}

function sheetDescription(r: SheetRequest): string {
  switch (r.mode) {
    case 'claim':
    case 'pledge':
    case 'cover':
    case 'edit':
      return r.view.item.title
    case 'withdraw':
      return `${r.title}. Others will see it as available again.`
    case 'nickname':
      return 'Friends with the link see it next to the wishes you are getting or chipping in on.'
  }
}

function Body({ request, session, onDone }: { request: SheetRequest; session: GiverListSession; onDone: (succeeded: boolean) => void }) {
  const notify = useNotify()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const view = 'view' in request ? request.view : null
  const state = view?.state
  const price = view?.item.price
  const editRow = request.mode === 'edit' ? request.row : null
  // Once the owner closes contributions, a pledge may be lowered but not raised.
  const pledgeCap = editRow?.kind === 'pledge' && view && !view.item.allowContributions ? editRow.amount : undefined

  const maxQty = request.mode === 'claim' ? (state?.remainingQuantity ?? 1) : editRow?.kind === 'full' ? (state?.remainingQuantity ?? 0) + editRow.quantity : 1
  const [qty, setQty] = useState(String(editRow?.kind === 'full' ? editRow.quantity : 1))
  const [amount, setAmount] = useState(editRow?.amount ? moneyInputValue(editRow.amount) : '')
  const [nickname, setNickname] = useState(request.mode === 'nickname' ? (request.current ?? '') : '')
  const [applyExisting, setApplyExisting] = useState(true)

  const finish = (results: ClaimActionResult[], ok: string) => {
    onDone(true)
    notify(claimResultMessage(results, ok))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(undefined)
    try {
      setBusy(true)
      const title = view?.item.title ?? ''
      switch (request.mode) {
        case 'claim': {
          const q = Number(qty)
          if (!Number.isSafeInteger(q) || q < 1 || q > maxQty) {
            setError(`Choose a number from 1 to ${maxQty}.`)
            break
          }
          finish([await session.claim(request.view.item.id, q)], `Thank you! Others now see that you are getting ${title}.`)
          break
        }
        case 'pledge': {
          if (!price) break
          const m = parseMoneyInput(amount, price.currency)
          if (!m) {
            setError('Enter an amount like 20 or 12.50.')
            break
          }
          finish([await session.pledge(request.view.item.id, m.amount)], `Thank you! You chipped in ${moneyText(m)}.`)
          break
        }
        case 'cover':
          finish([await session.coverTheRest(request.view.item.id)], `Thank you! ${title} is now fully covered.`)
          break
        case 'edit': {
          if (request.row.kind === 'full') {
            const q = Number(qty)
            if (!Number.isSafeInteger(q) || q < 1 || q > maxQty) {
              setError(`Choose a number from 1 to ${maxQty}.`)
              break
            }
            finish([await session.updateClaim(request.row.claimId, { quantity: q })], 'Updated.')
          } else {
            const currency = request.row.amount?.currency ?? price?.currency
            const m = currency ? parseMoneyInput(amount, currency) : undefined
            if (!m) {
              setError('Enter an amount like 20 or 12.50.')
              break
            }
            if (pledgeCap && m.amount > pledgeCap.amount) {
              setError(`New contributions are closed, so you can only lower your amount (up to ${moneyText(pledgeCap)}).`)
              break
            }
            finish([await session.updateClaim(request.row.claimId, { amount: m.amount })], `Updated to ${moneyText(m)}.`)
          }
          break
        }
        case 'withdraw':
          finish([await session.withdraw(request.claimId)], 'Taken back. Others see it as available again.')
          break
        case 'nickname': {
          const n = nickname.trim()
          finish(await session.setNickname(n || undefined, { applyToExisting: applyExisting }), n ? `Friends now see you as ${n}.` : 'Friends now see you as Someone.')
          break
        }
      }
    } catch (err) {
      setError(actionErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="app-stack" onSubmit={(e) => void submit(e)} noValidate>
      {request.mode === 'claim' ? (
        maxQty > 1 ? (
          <TextField
            label="How many will you get?"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxQty}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            hint={`${maxQty} still wanted.`}
            {...(error ? { error } : {})}
          />
        ) : null
      ) : null}

      {request.mode === 'pledge' && price ? (
        <MoneyField
          label="Your amount"
          currency={price.currency}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="20"
          hint={state?.remainingAmount !== undefined ? `${moneyText({ amount: state.remainingAmount, currency: price.currency })} still needed. Hippo only records it; you settle up between yourselves.` : undefined}
          {...(error ? { error } : {})}
        />
      ) : null}

      {request.mode === 'cover' && state?.remainingAmount !== undefined && price ? (
        <p className="app-note">
          {`You will cover the remaining ${moneyText({ amount: state.remainingAmount, currency: price.currency })}.`}
        </p>
      ) : null}

      {request.mode === 'edit' ? (
        request.row.kind === 'full' ? (
          <TextField
            label="How many will you get?"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxQty}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            hint={`Up to ${maxQty}.`}
            {...(error ? { error } : {})}
          />
        ) : (
          <MoneyField
            label="Your amount"
            currency={request.row.amount?.currency ?? price?.currency ?? 'USD'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            {...(pledgeCap ? { hint: 'New contributions are closed, so you can lower your amount but not raise it.' } : {})}
            {...(error ? { error } : {})}
          />
        )
      ) : null}

      {request.mode === 'nickname' ? (
        <>
          <TextField
            label="Nickname"
            value={nickname}
            maxLength={LIMITS.nickname}
            placeholder="Someone"
            autoComplete="nickname"
            onChange={(e) => setNickname(e.target.value)}
            hint="Leave empty to appear as Someone."
            {...(error ? { error } : {})}
          />
          <Checkbox label="Also show it on wishes I am already getting or chipping in on" checked={applyExisting} onChange={(e) => setApplyExisting(e.target.checked)} />
        </>
      ) : null}

      {error && (request.mode === 'cover' || request.mode === 'withdraw' || (request.mode === 'claim' && maxQty <= 1)) ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" variant={request.mode === 'withdraw' ? 'danger' : 'primary'} fullWidth loading={busy}>
        {request.mode === 'claim'
          ? "I'll get this"
          : request.mode === 'pledge'
            ? 'Chip in'
            : request.mode === 'cover'
              ? 'Cover the rest'
              : request.mode === 'withdraw'
                ? 'Take it back'
                : 'Save'}
      </Button>
    </form>
  )
}

export interface ClaimSheetProps {
  request: SheetRequest | null
  session: GiverListSession
  /** `succeeded` is true when the action was saved (the caller moves focus to the wish's card). */
  onClose: (succeeded: boolean) => void
}

export function ClaimSheet({ request, session, onClose }: ClaimSheetProps) {
  // Keep the last request so the title stays put while the sheet closes;
  // `n` remounts the form for every new request.
  const [track, setTrack] = useState<{ current: SheetRequest | null; shown: SheetRequest | null; n: number }>({ current: request, shown: request, n: 0 })
  // The body stays too, so the sheet leaves whole instead of emptying first.
  if (request !== track.current) setTrack({ current: request, shown: request ?? track.shown, n: request ? track.n + 1 : track.n })
  const shown = request ?? track.shown
  return (
    <BottomSheet open={request !== null} onClose={() => onClose(false)} title={shown ? sheetTitle(shown) : ''} {...(shown ? { description: sheetDescription(shown) } : {})}>
      {shown ? <Body key={track.n} request={shown} session={session} onDone={onClose} /> : null}
    </BottomSheet>
  )
}
