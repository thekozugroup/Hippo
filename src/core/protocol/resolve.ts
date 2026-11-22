// Claim resolution, PROTOCOL.md section 6. Pure and deterministic: every
// giver who holds the same claims computes the same state.

import type { ClaimKind, ClaimPayload, ItemPayload, Money } from '../model/types.ts'

export type ItemStatus = 'available' | 'partial' | 'funded' | 'claimed' | 'purchased'

export interface ResolveClaim {
  eventId: string
  pubkey: string
  /** The current event's `created_at` (unix seconds); bounds the claim's effective time. */
  eventCreatedAt: number
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
  /**
   * A full claim that did not fit in the wanted quantity (FR-23): another
   * claim was counted first. Purchased claims are counted before reserved
   * ones, so a reserved claim can also be displaced by someone who already
   * bought the gift.
   */
  conflict: boolean
  /** A pledge whose currency differs from the item price; it is not counted. */
  currencyMismatch: boolean
  /** Effective time: `min(payload.createdAt, event created_at)`, ms. */
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

/**
 * A claim's effective time. The payload's `createdAt` is chosen by its
 * author; it may not be later than the signed event that carries it.
 */
export function effectiveClaimTime(c: Pick<ResolveClaim, 'eventCreatedAt' | 'payload'>): number {
  return Math.min(c.payload.createdAt, c.eventCreatedAt * 1000)
}

function compareByTime(a: ResolveClaim, b: ResolveClaim): number {
  const ta = effectiveClaimTime(a)
  const tb = effectiveClaimTime(b)
  if (ta !== tb) return ta - tb
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0
}

/** Grant order: purchased claims first, then reserved ones, each by effective time. */
function compareForGrant(a: ResolveClaim, b: ResolveClaim): number {
  const pa = a.payload.status === 'purchased' ? 0 : 1
  const pb = b.payload.status === 'purchased' ? 0 : 1
  return pa - pb || compareByTime(a, b)
}

export function resolveItemState(
  item: ResolvableItem,
  claims: readonly ResolveClaim[],
  options: { myPubkey?: string } = {},
): ItemState {
  const live = claims
    .filter((c) => c.payload.itemId === item.id && c.payload.status !== 'withdrawn')
    .sort(compareByTime)

  // Decide which full claims fit, in grant order, before building rows in time order.
  const grantedIds = new Set<string>()
  let granted = 0
  let grantedAllPurchased = true
  for (const c of [...live].sort(compareForGrant)) {
    if (c.payload.kind !== 'full') continue
    const q = c.payload.quantity ?? 1
    if (granted + q <= item.quantity) {
      granted += q
      grantedIds.add(c.eventId)
      if (c.payload.status !== 'purchased') grantedAllPurchased = false
    }
  }

  const price = item.price
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
      createdAt: effectiveClaimTime(c),
    }
    if (p.nickname !== undefined) row.nickname = p.nickname
    if (p.kind === 'full') {
      row.quantity = p.quantity ?? 1
      row.conflict = !grantedIds.has(c.eventId)
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
