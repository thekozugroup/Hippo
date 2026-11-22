// Plain-English descriptions of claim rows and errors for the giver view.

import { isHippoError, type ClaimRow, type ItemPayload, type ItemState } from '../../../core/index.ts'
import { moneyText } from '../../lib/format.ts'

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
  return `${who} chipped in ${amount}${row.status === 'purchased' ? ' (paid)' : ''}`
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
  if (isHippoError(e, 'contributions-disabled')) return 'This wish no longer takes contributions.'
  if (isHippoError(e, 'list-unpublished')) return 'This list is no longer shared, so it cannot be changed.'
  if (isHippoError(e, 'not-my-claim')) return 'You can only change what you marked yourself.'
  if (isHippoError(e, 'invalid-input')) {
    if (/pledges/.test(e.message)) return 'Friends have already chipped in on this. Use "Cover the rest" instead.'
    return 'That amount or number does not work. Please check it.'
  }
  return 'Something went wrong. Please try again.'
}
