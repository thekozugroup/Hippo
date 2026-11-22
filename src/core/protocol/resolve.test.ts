// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ClaimPayload, ItemPayload } from '../model/types.ts'
import { effectiveClaimTime, resolveItemState, type ResolveClaim } from './resolve.ts'

const ITEM = 'a'.repeat(32)
let seq = 0

function item(extra: Partial<ItemPayload> = {}): ItemPayload {
  return { v: 1, id: ITEM, title: 'Hippo', quantity: 1, importance: 'love', allowContributions: true, updatedAt: 1, ...extra }
}

function claim(extra: Partial<ClaimPayload> & { pubkey?: string; eventId?: string; eventCreatedAt?: number } = {}): ResolveClaim {
  seq++
  const { pubkey = 'p'.repeat(64), eventId = seq.toString(16).padStart(64, '0'), eventCreatedAt = 2_000_000_000, ...payload } = extra
  return {
    eventId,
    pubkey,
    eventCreatedAt,
    payload: { v: 1, id: seq.toString(16).padStart(32, '0'), itemId: ITEM, kind: 'full', status: 'reserved', createdAt: seq, updatedAt: seq, ...payload },
  }
}

const pledge = (amount: number, extra: Partial<ClaimPayload> & { pubkey?: string } = {}): ResolveClaim =>
  claim({ kind: 'pledge', amount: { amount, currency: 'EUR' }, ...extra })

const EUR = (amount: number) => ({ amount, currency: 'EUR' })

describe('resolveItemState', () => {
  it('is available with no claims', () => {
    const s = resolveItemState(item({ price: EUR(5000) }), [])
    expect(s).toMatchObject({ status: 'available', grantedQuantity: 0, remainingQuantity: 1, pledged: 0, remainingAmount: 5000, target: EUR(5000) })
  })

  it('claims a single item and marks it purchased', () => {
    expect(resolveItemState(item(), [claim()]).status).toBe('claimed')
    expect(resolveItemState(item(), [claim({ status: 'purchased' })]).status).toBe('purchased')
  })

  it('grants quantities in order and is partial until all are taken', () => {
    const s = resolveItemState(item({ quantity: 3 }), [claim({ quantity: 2 })])
    expect(s).toMatchObject({ status: 'partial', grantedQuantity: 2, remainingQuantity: 1 })
    const full = resolveItemState(item({ quantity: 3 }), [claim({ quantity: 2 }), claim({ quantity: 1, status: 'purchased' })])
    expect(full.status).toBe('claimed')
    const bought = resolveItemState(item({ quantity: 3 }), [claim({ quantity: 2, status: 'purchased' }), claim({ status: 'purchased' })])
    expect(bought.status).toBe('purchased')
  })

  it('marks claims that do not fit as conflicts, earliest wins', () => {
    const a = claim({ createdAt: 10, pubkey: 'a'.repeat(64) })
    const b = claim({ createdAt: 11, pubkey: 'b'.repeat(64) })
    const s = resolveItemState(item(), [b, a], { myPubkey: 'b'.repeat(64) })
    expect(s.status).toBe('claimed')
    expect(s.rows.map((r) => [r.claimId, r.conflict, r.mine])).toEqual([
      [a.payload.id, false, false],
      [b.payload.id, true, true],
    ])
  })

  it('lets a later smaller claim fit after a conflicting larger one', () => {
    const s = resolveItemState(item({ quantity: 2 }), [claim({ quantity: 1 }), claim({ quantity: 2 }), claim({ quantity: 1 })])
    expect(s.rows.map((r) => r.conflict)).toEqual([false, true, false])
    expect(s.status).toBe('claimed')
  })

  it('ignores withdrawn claims and claims for other items', () => {
    const s = resolveItemState(item(), [claim({ status: 'withdrawn' }), claim({ itemId: 'b'.repeat(32) })])
    expect(s.status).toBe('available')
    expect(s.rows).toEqual([])
  })

  it('sums pledges towards the price', () => {
    const s = resolveItemState(item({ price: EUR(10000) }), [pledge(3000), pledge(2000, { nickname: 'Ann' })])
    expect(s).toMatchObject({ status: 'partial', pledged: 5000, pledgeCount: 2, remainingAmount: 5000, surplus: 0 })
    expect(s.rows[1]?.nickname).toBe('Ann')
  })

  it('is funded at the target and shows over-funding as surplus', () => {
    expect(resolveItemState(item({ price: EUR(10000) }), [pledge(6000), pledge(4000)]).status).toBe('funded')
    const over = resolveItemState(item({ price: EUR(10000) }), [pledge(8000), pledge(5000)])
    expect(over).toMatchObject({ status: 'funded', remainingAmount: 0, surplus: 3000 })
  })

  it('funds against price * quantity', () => {
    const s = resolveItemState(item({ price: EUR(1000), quantity: 3 }), [pledge(2000)])
    expect(s).toMatchObject({ status: 'partial', target: EUR(3000), remainingAmount: 1000 })
    expect(resolveItemState(item({ price: EUR(1000), quantity: 3 }), [pledge(3000)]).status).toBe('funded')
  })

  it('recomputes progress when the price changes', () => {
    const claims = [pledge(5000)]
    expect(resolveItemState(item({ price: EUR(5000) }), claims).status).toBe('funded')
    expect(resolveItemState(item({ price: EUR(8000) }), claims)).toMatchObject({ status: 'partial', remainingAmount: 3000 })
  })

  it('does not count pledges in another currency', () => {
    const s = resolveItemState(item({ price: EUR(1000) }), [claim({ kind: 'pledge', amount: { amount: 5000, currency: 'USD' } })])
    expect(s).toMatchObject({ status: 'available', pledged: 0, pledgeCount: 0 })
    expect(s.rows[0]?.currencyMismatch).toBe(true)
  })

  it('does not count pledges when the item has no price', () => {
    const s = resolveItemState(item(), [pledge(5000)])
    expect(s).toMatchObject({ status: 'available', pledged: 0 })
    expect(s.remainingAmount).toBeUndefined()
    expect(s.rows).toHaveLength(1)
  })

  it('counts full claims and pledges together for multi-quantity items', () => {
    const s = resolveItemState(item({ price: EUR(1000), quantity: 2 }), [claim(), pledge(1000)])
    expect(s).toMatchObject({ status: 'funded', grantedQuantity: 1, remainingAmount: 0 })
  })

  it('is deterministic under input order shuffling', () => {
    const claims = [
      claim({ createdAt: 5 }),
      claim({ createdAt: 5 }),
      claim({ createdAt: 3, quantity: 2 }),
      pledge(700, { createdAt: 1 }),
      claim({ createdAt: 9, status: 'purchased' }),
      claim({ createdAt: 2, status: 'withdrawn' }),
    ]
    const it = item({ quantity: 3, price: EUR(1000) })
    const expected = resolveItemState(it, claims)
    for (let i = 0; i < 50; i++) {
      const shuffled = [...claims].sort(() => Math.random() - 0.5)
      expect(resolveItemState(it, shuffled)).toEqual(expected)
    }
  })

  describe('claim ordering (PROTOCOL.md section 6)', () => {
    const HONEST = 'h'.repeat(64)
    const ATTACKER = 'x'.repeat(64)

    it('never lets a backdated reserved claim displace a purchased one', () => {
      const honest = claim({ createdAt: 1_790_000_000_000, status: 'purchased', pubkey: HONEST })
      const backdated = claim({ createdAt: 0, pubkey: ATTACKER })
      const s = resolveItemState(item(), [honest, backdated], { myPubkey: HONEST })
      expect(s.status).toBe('purchased')
      const mine = s.rows.find((r) => r.mine)
      expect(mine?.conflict).toBe(false)
      expect(s.rows.find((r) => !r.mine)?.conflict).toBe(true)
    })

    it('ranks purchased claims ahead of reserved ones for the remaining quantity', () => {
      const early = claim({ createdAt: 1, quantity: 2, pubkey: 'a'.repeat(64) })
      const bought = claim({ createdAt: 50, quantity: 2, status: 'purchased', pubkey: 'b'.repeat(64) })
      const s = resolveItemState(item({ quantity: 3 }), [early, bought])
      expect(s.rows.map((r) => [r.claimId, r.conflict])).toEqual([
        [early.payload.id, true],
        [bought.payload.id, false],
      ])
      expect(s.grantedQuantity).toBe(2)
    })

    it('bounds a claim time above by its signed event: a late-dated payload cannot jump the queue backwards or forwards', () => {
      // Payload says "very late" but the event was signed early: the event time counts.
      const c = claim({ createdAt: 9_000_000_000_000, eventCreatedAt: 100 })
      expect(effectiveClaimTime(c)).toBe(100_000)
      const other = claim({ createdAt: 200_000, pubkey: 'o'.repeat(64) })
      const s = resolveItemState(item(), [other, c])
      expect(s.rows[0]?.claimId).toBe(c.payload.id)
      expect(s.rows[0]?.createdAt).toBe(100_000)
      expect(s.rows[1]?.conflict).toBe(true)
    })

    it('still lets a backdated reserved claim win among reserved claims (documented residual limitation)', () => {
      const honest = claim({ createdAt: 1_790_000_000_000, pubkey: HONEST })
      const backdated = claim({ createdAt: 0, eventCreatedAt: 0, pubkey: ATTACKER })
      const s = resolveItemState(item(), [honest, backdated], { myPubkey: HONEST })
      expect(s.rows.find((r) => r.mine)?.conflict).toBe(true)
    })
  })
})
