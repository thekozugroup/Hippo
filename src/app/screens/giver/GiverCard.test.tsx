import { render, screen, within } from '@testing-library/react'
import { resolveItemState, type ClaimPayload, type GiverListView, type ItemPayload, type ResolveClaim } from '../../../core/index.ts'
import { GiverItemCard } from './GiverItemCard.tsx'
import { GiverRemovedSection } from './GiverScreen.tsx'

const ME = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const T = Date.UTC(2026, 10, 1)
let n = 0

function item(over: Partial<ItemPayload> = {}): ItemPayload {
  return { v: 1, id: '0'.repeat(32), title: 'Espresso machine', quantity: 1, importance: 'want', allowContributions: false, updatedAt: T, ...over }
}

function claim(pubkey: string, c: Partial<ClaimPayload>, at = T): ResolveClaim {
  n++
  const id = n.toString(16).padStart(32, '0')
  return {
    eventId: id.padStart(64, '0'),
    pubkey,
    eventCreatedAt: Math.floor(at / 1000) + 1,
    payload: { v: 1, id, itemId: '0'.repeat(32), kind: 'full', status: 'reserved', createdAt: at, updatedAt: at, ...c },
  }
}

function renderCard(it: ItemPayload, claims: ResolveClaim[] = []) {
  const view = { item: it, state: resolveItemState(it, claims, { myPubkey: ME }) }
  render(<GiverItemCard view={view} pendingClaimIds={[]} onRequest={() => undefined} onMarkPurchased={() => undefined} />)
  return screen.getByRole('article', { name: it.title })
}

const priced = { price: { amount: 20000, currency: 'USD' } }

describe('giver wish card states', () => {
  it('available: no status pill, one main action "I\'ll get this"', () => {
    const card = renderCard(item())
    expect(card.querySelector('.status-pill')).toBeNull()
    expect(within(card).getAllByRole('button')).toHaveLength(1)
    expect(within(card).getByRole('button', { name: "I'll get this" })).toBeInTheDocument()
    expect(within(card).getByRole('heading', { name: 'Espresso machine' })).toHaveAttribute('tabindex', '-1')
  })

  it('partly covered: shows progress, "Cover the rest" and "Chip in"', () => {
    const card = renderCard(item({ ...priced, allowContributions: true }), [claim(OTHER, { kind: 'pledge', amount: { amount: 5000, currency: 'USD' }, nickname: 'Maya' })])
    expect(card.querySelector('.status-pill')).toBeNull()
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '25% covered, $150.00 left')
    const line = card.querySelector('.giver-item__funding-line')
    expect(line?.textContent).toBe('25%$150.00 left')
    expect(within(card).queryByText(/ of \$/)).toBeNull()
    expect(within(card).getByText('Maya chipped in $50.00')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Cover the rest' })).toHaveClass('btn--primary')
    expect(within(card).getByRole('button', { name: 'Chip in' })).not.toHaveClass('btn--primary')
    expect(within(card).queryByRole('button', { name: "I'll get this" })).toBeNull()
  })

  it('fully covered: no actions left', () => {
    const card = renderCard(item({ ...priced, allowContributions: true }), [claim(OTHER, { kind: 'pledge', amount: { amount: 20000, currency: 'USD' } })])
    expect(within(card).getByText('Covered', { selector: '.status-pill' })).toBeInTheDocument()
    expect(card.querySelector('.giver-item__funding-line')?.textContent).toBe('100%Covered')
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '100% covered')
    expect(within(card).queryByRole('button', { name: /Cover the rest|Chip in|I'll get this/ })).toBeNull()
  })

  it('claimed by me: says so and offers my own actions', () => {
    const card = renderCard(item(), [claim(ME, { quantity: 1 })])
    expect(within(card).getByText("You're getting this", { selector: '.status-pill' })).toBeInTheDocument()
    // The pill already says it, so the line of my actions does not repeat it.
    expect(within(card).queryByText('You are getting this')).toBeNull()
    expect(within(card).queryAllByRole('button', { name: /I'll get this|Chip in|Cover/ })).toHaveLength(0)
    for (const name of ['Mark bought', 'Change', 'Take back']) expect(within(card).getByRole('button', { name })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: "I'll get this" })).toBeNull()
  })

  it('claimed by someone else: no actions', () => {
    const card = renderCard(item(), [claim(OTHER, { quantity: 1 })])
    expect(within(card).getByText('Someone is getting this', { selector: '.status-pill' })).toBeInTheDocument()
    expect(within(card).getAllByText(/getting this/)).toHaveLength(1)
    expect(within(card).queryAllByRole('button')).toHaveLength(0)
  })

  it('conflict: my later claim is not counted and I can take it back', () => {
    const card = renderCard(item(), [claim(OTHER, { quantity: 1 }, T), claim(ME, { quantity: 1 }, T + 5000)])
    expect(within(card).getByText('Not counted')).toBeInTheDocument()
    expect(within(card).getByRole('note')).toHaveTextContent('Someone else said they would get this first')
    expect(within(card).getByRole('button', { name: 'Take back' })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Mark bought' })).toBeNull()
    expect(within(card).getByText('You are getting this (not counted)')).toBeInTheDocument()
  })

  it('contributions closed after a pledge: no "Cover the rest" or "Chip in", my pledge can still change', () => {
    const card = renderCard(item({ ...priced, allowContributions: false }), [claim(ME, { kind: 'pledge', amount: { amount: 5000, currency: 'USD' } })])
    expect(within(card).getByText(/Closed to new contributions\. You can still lower your amount/)).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Cover the rest' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Chip in' })).toBeNull()
    expect(within(card).queryByRole('button', { name: "I'll get this" })).toBeNull()
    expect(within(card).getByRole('button', { name: 'Change' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Take back' })).toBeInTheDocument()
  })
})

describe('giver wish card: one surface, exceptions only', () => {
  it('over-covered: says how much more than needed, no actions', () => {
    const it2 = item({ ...priced, allowContributions: true })
    const card = renderCard(it2, [claim(OTHER, { kind: 'pledge', amount: { amount: 25000, currency: 'USD' } })])
    expect(within(card).getByText('Covered', { selector: '.status-pill' })).toBeInTheDocument()
    expect(card.querySelector('.giver-item__funding-line')?.textContent).toBe('100%Covered')
    expect(within(card).getByText('$50.00 more than needed')).toBeInTheDocument()
    expect(within(card).queryAllByRole('button')).toHaveLength(0)
  })

  it('bought by a named friend: the pill names them and no row repeats it', () => {
    const card = renderCard(item(), [claim(OTHER, { quantity: 1, status: 'purchased', nickname: 'Ben' })])
    expect(within(card).getByText('Ben bought this', { selector: '.status-pill' })).toBeInTheDocument()
    expect(within(card).getAllByText(/bought/)).toHaveLength(1)
  })

  it('never nests a bordered box and offers each action once', () => {
    const card = renderCard(item({ ...priced, allowContributions: true }), [claim(ME, { kind: 'pledge', amount: { amount: 5000, currency: 'USD' } })])
    expect(card.querySelector('.giver-item .giver-item, .app-banner')).toBeNull()
    const names = within(card).getAllByRole('button').map((b) => b.textContent)
    expect(new Set(names).size).toBe(names.length)
    expect(card.querySelectorAll('.btn--primary')).toHaveLength(1)
  })
})

function viewWith(status: GiverListView['status'], title?: string): GiverListView {
  const c: ClaimPayload = { v: 1, id: '9'.repeat(32), itemId: '1'.repeat(32), kind: 'full', quantity: 1, status: 'reserved', createdAt: T, updatedAt: T }
  return {
    topic: 'f'.repeat(64),
    status,
    meta: { v: 1, name: 'Birthday', itemIds: [], showPrices: true, showNotes: true, status: status === 'unpublished' ? 'unpublished' : 'published', updatedAt: T },
    items: [],
    removedItemsWithMyClaims: [{ itemId: '1'.repeat(32), item: null, myClaims: [c], ...(title ? { title } : {}) }],
    myPubkey: ME,
    pendingClaimIds: [],
  }
}

describe('giver: my gifts on wishes no longer on the list', () => {
  it('removed by the owner keeps the remembered title', () => {
    render(<GiverRemovedSection view={viewWith('live', 'Wool socks')} onRequest={() => undefined} />)
    expect(screen.getByRole('heading', { name: 'Taken off the list' })).toBeInTheDocument()
    const card = screen.getByRole('article', { name: 'Wool socks' })
    expect(within(card).getByText('Taken off')).toBeInTheDocument()
    expect(within(card).getByText('You are getting this')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Take back' })).toBeInTheDocument()
  })

  it('unpublished list talks about the list no longer being shared, not about removal', () => {
    render(<GiverRemovedSection view={viewWith('unpublished', 'Wool socks')} onRequest={() => undefined} />)
    expect(screen.getByRole('heading', { name: 'Your gifts from this list' })).toBeInTheDocument()
    expect(screen.getByText(/no longer sharing this list/)).toBeInTheDocument()
    const card = screen.getByRole('article', { name: 'Wool socks' })
    expect(within(card).getByText('No longer shared')).toBeInTheDocument()
    expect(screen.queryByText(/Removed by the owner|A removed wish/)).toBeNull()
  })
})
