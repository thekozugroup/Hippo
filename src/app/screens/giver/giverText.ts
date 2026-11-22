// Plain-English descriptions of claim rows, states and errors for the giver
// view. Vocabulary: "wish" (an entry on a list), "I'll get this" / "getting
// this" (a full claim), "chip in" (a partial contribution), "bought".

import { isHippoError, type ClaimRow, type ItemPayload, type ItemState } from '../../../core/index.ts'
import type { Status } from '../../../ui/index.ts'
import { moneyText } from '../../lib/format.ts'
import type { SheetRequest } from './ClaimSheet.tsx'

/** Shown wherever the app talks about what the list owner can see. Hiding is done by the app, not by encryption (PRD 4.5). */
export const OWNER_HIDDEN_NOTE = 'Hippo hides this from the list owner. Other friends with the link can see it.'

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

/** Status pill for a wish card, in the giver vocabulary. */
export function giverPill(item: ItemPayload, state: ItemState): PillState {
  const myRows = state.rows.filter((r) => r.mine)
  if (myRows.some((r) => r.conflict)) return { status: 'conflict', label: 'Not counted' }
  switch (state.status) {
    case 'available':
      return { status: 'available', label: 'Available' }
    case 'partial':
      return { status: 'partial', label: state.pledgeCount > 0 ? 'Partly covered' : `${state.remainingQuantity} still wanted` }
    case 'funded':
      return { status: 'funded', label: 'Covered' }
    case 'purchased':
      return { status: 'purchased', label: 'Bought' }
    case 'claimed': {
      const granted = state.rows.filter((r) => r.kind === 'full' && !r.conflict)
      const allMine = granted.length > 0 && granted.every((r) => r.mine)
      return { status: 'claimed', label: allMine ? (item.quantity > 1 ? "You're getting these" : "You're getting this") : 'Someone is getting this' }
    }
  }
}

/** Share of the target that is covered, 0..1, or null when funding is not shown. */
export function fundingProgress(item: ItemPayload, state: ItemState): { value: number; text: string } | null {
  if (!state.target || state.target.amount <= 0) return null
  if (!item.allowContributions && state.pledgeCount === 0) return null
  const remaining = state.remainingAmount ?? 0
  const covered = Math.max(0, state.target.amount - remaining)
  return {
    value: covered / state.target.amount,
    text: `${moneyText({ amount: covered, currency: state.target.currency })} of ${moneyText(state.target)} covered`,
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
