import { resolveItemState, type ClaimPayload, type ItemPayload, type ResolveClaim } from '../../../core/index.ts'
import { claimResultMessage, coveredPercent, fundingProgress, OFFLINE_SAVED_NOTE } from './giverText.ts'

const T = Date.UTC(2026, 10, 1)
const OTHER = 'b'.repeat(64)
let n = 0

function item(over: Partial<ItemPayload> = {}): ItemPayload {
  return { v: 1, id: '0'.repeat(32), title: 'Wish', quantity: 1, importance: 'want', allowContributions: true, updatedAt: T, ...over }
}

function pledge(amount: number, currency: string): ResolveClaim {
  n++
  const id = n.toString(16).padStart(32, '0')
  const payload: ClaimPayload = { v: 1, id, itemId: '0'.repeat(32), kind: 'pledge', status: 'reserved', amount: { amount, currency }, createdAt: T, updatedAt: T }
  return { eventId: id.padStart(64, '0'), pubkey: OTHER, eventCreatedAt: Math.floor(T / 1000) + 1, payload }
}

function funding(it: ItemPayload, claims: ResolveClaim[]) {
  return fundingProgress(it, resolveItemState(it, claims, { myPubkey: 'a'.repeat(64) }))
}

describe('coveredPercent', () => {
  it('is a whole number', () => {
    expect(coveredPercent(5000, 24900)).toBe(20)
    expect(coveredPercent(1, 3)).toBe(33)
    expect(coveredPercent(2, 3)).toBe(66)
  })

  it('never reads 100 unless fully covered', () => {
    expect(coveredPercent(996, 1000)).toBe(99)
    expect(coveredPercent(99999, 100000)).toBe(99)
    expect(coveredPercent(1000, 1000)).toBe(100)
  })

  it('never goes above 100', () => {
    expect(coveredPercent(5000, 1000)).toBe(100)
  })

  it('reads at least 1 for any contribution, and 0 for none', () => {
    expect(coveredPercent(1, 100000)).toBe(1)
    expect(coveredPercent(0, 1000)).toBe(0)
  })

  it('copes with unusable input', () => {
    expect(coveredPercent(-5, 1000)).toBe(0)
    expect(coveredPercent(5, 0)).toBe(0)
    expect(coveredPercent(Number.NaN, 1000)).toBe(0)
    expect(coveredPercent(5, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('fundingProgress', () => {
  it('shows the percentage at the start and what is left at the end', () => {
    const f = funding(item({ price: { amount: 24900, currency: 'USD' } }), [pledge(5000, 'USD')])
    expect(f).toMatchObject({ percent: '20%', rest: '$199.00 left', text: '20% covered, $199.00 left', surplus: null })
  })

  it('has no bar without a price', () => {
    expect(funding(item(), [])).toBeNull()
  })

  it('counts the whole quantity as the target', () => {
    const f = funding(item({ quantity: 3, price: { amount: 10000, currency: 'USD' } }), [pledge(7500, 'USD')])
    expect(f).toMatchObject({ percent: '25%', rest: '$225.00 left' })
  })

  it('formats a currency without decimals', () => {
    const f = funding(item({ price: { amount: 8000, currency: 'JPY' } }), [pledge(2000, 'JPY')])
    expect(f?.percent).toBe('25%')
    expect(f?.rest).toMatch(/6,000 left$/)
    expect(f?.rest).not.toMatch(/\.\d/)
  })

  it('formats a three-decimal currency', () => {
    const f = funding(item({ price: { amount: 10000, currency: 'KWD' } }), [pledge(2500, 'KWD')])
    expect(f?.percent).toBe('25%')
    expect(f?.rest).toMatch(/7\.500 left$/)
  })

  it('shows 99% for almost covered and at least 1% for a tiny pledge', () => {
    expect(funding(item({ price: { amount: 100000, currency: 'USD' } }), [pledge(99600, 'USD')])?.percent).toBe('99%')
    expect(funding(item({ price: { amount: 100000, currency: 'USD' } }), [pledge(10, 'USD')])?.percent).toBe('1%')
  })

  it('fully covered reads 100% and Covered', () => {
    const f = funding(item({ price: { amount: 20000, currency: 'USD' } }), [pledge(20000, 'USD')])
    expect(f).toMatchObject({ percent: '100%', rest: 'Covered', text: '100% covered', surplus: null })
  })

  it('over-covered keeps a separate note about the surplus', () => {
    const f = funding(item({ price: { amount: 20000, currency: 'USD' } }), [pledge(25000, 'USD')])
    expect(f).toMatchObject({ percent: '100%', rest: 'Covered', surplus: '$50.00 more than needed' })
  })
})

describe('claimResultMessage', () => {
  const ok = { ok: true, relays: [{ relay: 'r', ok: true }] }
  const claim = { v: 1 as const, id: 'c', itemId: 'i', kind: 'full' as const, status: 'reserved' as const, createdAt: 1, updatedAt: 1 }
  it('thanks the giver only when other devices would count it', () => {
    expect(claimResultMessage([{ claim, result: ok, outcome: { kind: 'counted' } }], 'Thank you!')).toBe('Thank you!')
    expect(claimResultMessage([{ claim, result: ok, outcome: { kind: 'not-counted', reason: 'taken' } }], 'Thank you!')).toBe(
      'Someone else got there first, so yours is not counted. You can take it back.',
    )
    expect(claimResultMessage([{ claim, result: ok, outcome: { kind: 'rejected', reason: 'future' } }], 'Thank you!')).toMatch(/clock on this device is wrong/)
    expect(claimResultMessage([{ claim, result: { ok: false, relays: [] }, outcome: { kind: 'counted' } }], 'Thank you!')).toBe(OFFLINE_SAVED_NOTE)
  })
})
