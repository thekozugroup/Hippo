// Claim resolution, PROTOCOL.md section 6. Pure and deterministic: every
// giver who holds the same claims computes the same state.

import type { ClaimKind, ClaimPayload, ItemPayload, Money } from '../model/types.ts'

export type ItemStatus = 'available' | 'partial' | 'funded' | 'claimed' | 'purchased'

export interface ResolveClaim {
  eventId: string
  pubkey: string
  payload: ClaimPayload
}

export interface ClaimRow {
  claimId: string
  eventId: string
  kind: ClaimKind
  /** Requested quantity for full claims; 0 for pledges. */
  quantity: number
  amount?: Money
  status: 'reserved' | 'purchased'
  nickname?: string
  mine: boolean
  /** A full claim that did not fit in the wanted quantity (FR-23). */
  conflict: boolean
  /** A pledge whose currency differs from the item price; it is not counted. */
  currencyMismatch: boolean
  createdAt: number
}

export interface ItemState {
  status: ItemStatus
  grantedQuantity: number
  remainingQuantity: number
  /** Sum of counted pledges in the item currency, minor units. */
  pledged: number
  pledgeCount: number
  /** price * quantity, when the item has a price. */
  target?: Money
  /** What is still needed after granted full claims and pledges; undefined without a price. */
  remainingAmount?: number
  /** Pledged beyond what was needed (4.6 over-funding). */
  surplus: number
  rows: ClaimRow[]
}

export type ResolvableItem = Pick<ItemPayload, 'id' | 'quantity' | 'price'>

function compareClaims(a: ResolveClaim, b: ResolveClaim): number {
  if (a.payload.createdAt !== b.payload.createdAt) return a.payload.createdAt - b.payload.createdAt
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0
}

export function resolveItemState(
  item: ResolvableItem,
  claims: readonly ResolveClaim[],
  options: { myPubkey?: string } = {},
): ItemState {
  const live = claims
    .filter((c) => c.payload.itemId === item.id && c.payload.status !== 'withdrawn')
    .sort(compareClaims)

  const price = item.price
  let granted = 0
  let grantedAllPurchased = true
  let pledged = 0
  let pledgeCount = 0
  const rows: ClaimRow[] = []

  for (const c of live) {
    const p = c.payload
    const status = p.status === 'purchased' ? 'purchased' : 'reserved'
    const row: ClaimRow = {
      claimId: p.id,
      eventId: c.eventId,
      kind: p.kind,
      quantity: 0,
      status,
      mine: options.myPubkey !== undefined && c.pubkey === options.myPubkey,
      conflict: false,
      currencyMismatch: false,
      createdAt: p.createdAt,
    }
    if (p.nickname !== undefined) row.nickname = p.nickname
    if (p.kind === 'full') {
      const q = p.quantity ?? 1
      row.quantity = q
      if (granted + q <= item.quantity) {
        granted += q
        if (status !== 'purchased') grantedAllPurchased = false
      } else {
        row.conflict = true
      }
    } else if (p.amount) {
      row.amount = p.amount
      if (price && p.amount.currency === price.currency) {
        pledged += p.amount.amount
        pledgeCount++
      } else {
        row.currencyMismatch = price !== undefined
      }
    }
    rows.push(row)
  }

  const remainingQuantity = item.quantity - granted
  const state: ItemState = {
    status: 'available',
    grantedQuantity: granted,
    remainingQuantity,
    pledged,
    pledgeCount,
    surplus: 0,
    rows,
  }

  if (price) {
    state.target = { amount: price.amount * item.quantity, currency: price.currency }
    // Full claims cover their units, pledges cover the rest. With no full
    // claims this is exactly section 6's `pledged >= price * quantity`.
    const needed = price.amount * remainingQuantity
    state.remainingAmount = Math.max(0, needed - pledged)
    state.surplus = Math.max(0, pledged - needed)
  }

  if (remainingQuantity === 0) {
    state.status = granted > 0 && grantedAllPurchased ? 'purchased' : 'claimed'
  } else if (pledgeCount > 0 && state.remainingAmount === 0) {
    state.status = 'funded'
  } else if (granted > 0 || pledged > 0) {
    state.status = 'partial'
  }
  return state
}
