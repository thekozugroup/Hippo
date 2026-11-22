// Plain-English descriptions of claim rows, states and errors for the giver
// view. Vocabulary: "wish" (an entry on a list), "I'll get this" / "getting
// this" (a full claim), "chip in" (a partial contribution), "bought".

import { isHippoError, type ClaimRow, type ItemPayload, type ItemState } from '../../../core/index.ts'
import type { Status } from '../../../ui/index.ts'
import { moneyText } from '../../lib/format.ts'
import type { SheetRequest } from './ClaimSheet.tsx'

/** Shown wherever the app talks about what the list owner can see. Hiding is done by the app, not by encryption (PRD 4.5). */
export const OWNER_HIDDEN_NOTE = 'Hippo hides who is getting what from the list owner. Friends with the link can see it.'

export const OFFLINE_SAVED_NOTE = 'Saved on this device. Hippo keeps trying to send it while this list is open.'

export function whoName(row: Pick<ClaimRow, 'mine' | 'nickname'>): string {
  return row.mine ? 'You' : (row.nickname ?? 'Someone')
}

export function describeRow(row: ClaimRow): string {
  const who = whoName(row)
  if (row.kind === 'full') {
    const what = row.quantity > 1 ? `${row.quantity} of these` : 'this'
    if (row.status === 'purchased') return `${who} bought ${what}`
    return `${who} ${row.mine ? 'are' : 'is'} getting ${what}`
  }
  const amount = row.amount ? moneyText(row.amount) : 'an amount'
  return `${who} chipped in ${amount}${row.status === 'purchased' ? ' (bought)' : ''}`
}

export interface PillState {
  status: Status
  label: string
}

/**
 * The status pill for a wish card, or null when the wish is still open to givers (available or
 * partly covered): an ordinary state carries no pill. Names the giver when one person is behind
 * the state, so a single "is getting this" claim needs no extra line.
 */
export function giverStatus(item: ItemPayload, state: ItemState): PillState | null {
  if (state.rows.some((r) => r.mine && r.conflict)) return { status: 'conflict', label: 'Not counted' }
  const these = item.quantity > 1 ? 'these' : 'this'
  const granted = state.rows.filter((r) => r.kind === 'full' && !r.conflict)
  const allMine = granted.length > 0 && granted.every((r) => r.mine)
  const one = allMine ? granted[0] : granted.length === 1 ? granted[0] : undefined
  switch (state.status) {
    case 'available':
    case 'partial':
      return null
    case 'funded':
      return { status: 'funded', label: 'Covered' }
    case 'purchased':
      return { status: 'purchased', label: one ? `${whoName(one)} bought ${these}` : 'Bought' }
    case 'claimed':
      if (!one) return { status: 'claimed', label: 'All taken care of' }
      return { status: 'claimed', label: one.mine ? `You're getting ${these}` : `${whoName(one)} is getting ${these}` }
  }
}

/**
 * Whether a claim row needs its own line of text. A single full claim is already named by the
 * status pill, so only pledges (an amount), claims for several, conflicts and claims outside
 * the counted ones get a line.
 */
export function rowNeedsText(row: ClaimRow, item: ItemPayload, state: ItemState): boolean {
  if (row.kind === 'pledge' || row.conflict || row.currencyMismatch) return true
  const granted = state.rows.filter((r) => r.kind === 'full' && !r.conflict)
  return item.quantity > 1 || granted.length > 1
}

export interface Funding {
  /** Share of the target that is covered, 0..1. */
  value: number
  /** Text alternative for the progressbar: "$50.00 of $200.00 covered". */
  text: string
  /** Start of the line under the bar: "$50.00 of $200.00". */
  covered: string
  /** End of the line: what is left, or what was pledged beyond the price. */
  rest: string
}

/** Funding progress for a wish, or null when funding is not shown. */
export function fundingProgress(item: ItemPayload, state: ItemState): Funding | null {
  if (!state.target || state.target.amount <= 0) return null
  if (!item.allowContributions && state.pledgeCount === 0) return null
  const remaining = state.remainingAmount ?? 0
  const covered = Math.max(0, state.target.amount - remaining)
  const currency = state.target.currency
  const coveredText = `${moneyText({ amount: covered, currency })} of ${moneyText(state.target)}`
  return {
    value: covered / state.target.amount,
    text: `${coveredText} covered`,
    covered: coveredText,
    rest:
      remaining > 0
        ? `${moneyText({ amount: remaining, currency })} left`
        : state.surplus > 0
          ? `${moneyText({ amount: state.surplus, currency })} more than needed`
          : 'Fully covered',
  }
}

export function actionErrorMessage(e: unknown): string {
  if (isHippoError(e, 'item-unavailable')) return 'Someone just took this, or it is no longer on the list. Have a look at what is still available.'
  if (isHippoError(e, 'contributions-disabled')) return 'This wish no longer takes new contributions. You can still lower your amount or take it back.'
  if (isHippoError(e, 'list-unpublished')) return 'This list is no longer shared, so it cannot be changed.'
  if (isHippoError(e, 'not-my-claim')) return 'You can only change your own gifts.'
  if (isHippoError(e, 'invalid-input')) {
    if (/pledges/.test(e.message)) return 'Friends have already chipped in on this. Use "Cover the rest" instead.'
    return 'That amount or number does not work. Please check it.'
  }
  return 'Something went wrong. Please try again.'
}

/** The wish a request is about, so focus can return to its card when the sheet closes. */
export function requestItemId(r: SheetRequest): string | undefined {
  if ('view' in r) return r.view.item.id
  if (r.mode === 'withdraw') return r.itemId
  return undefined
}

/** The id of a wish card's heading, the focus target after an action on that wish. */
export function itemHeadingId(itemId: string): string {
  return `item-${itemId}`
}
