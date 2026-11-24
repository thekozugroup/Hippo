// Regression tests for the final review: two-tab edits, unsaved drafts,
// setup (skip, unknown steps, two tabs), currency rules, the giver's
// connection banner and the clock notice.
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createCore,
  createItem,
  createSharedList,
  exportData,
  getItem,
  getSettings,
  importData,
  listSharedLists,
  MemoryTransport,
  openDb,
  setOnboarding,
  setOwnerName,
  updateItem,
  updateSharedList,
  type Clock,
  type Core,
} from '../core/index.ts'
import { App } from './App.tsx'
import { clearCaptureDraft, handleStartupCapture } from './core/capture.ts'
import { clockNoticeText } from './core/clockText.ts'
import { newFlow, reduceFlow, toStored } from './core/onboarding.ts'
import { readSetupHint, writeSetupHint } from './core/setupHint.ts'
import { priceExample } from './lib/format.ts'
import { ensureSetupList, ensureSetupWish, persistFlow } from './screens/onboarding/store.ts'

function testCore(extra: Partial<Parameters<typeof createCore>[0]> = {}): Core {
  return createCore({ dbName: `review-${Math.random()}`, transport: new MemoryTransport(), ...extra })
}

async function openAt(core: Core, hash: string, heading: string | RegExp) {
  window.location.hash = hash
  const view = render(<App core={core} />)
  await screen.findByRole('heading', { level: 1, name: heading })
  return view
}

beforeEach(() => {
  clearCaptureDraft()
  localStorage.clear()
})

describe('editing a wish in two places', () => {
  it('saves only the fields changed in this form, and says when one was also changed elsewhere', async () => {
    const core = testCore()
    const user = userEvent.setup()
    const item = await createItem(core.db, { title: 'Teapot', notes: 'Blue' })
    await openAt(core, `#/item/${item.id}`, 'Edit wish')

    // Another tab changes the notes and the name after this form loaded.
    await updateItem(core.db, item.id, { notes: 'Green, please', title: 'Big teapot' })
    // Here, only the name is changed.
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Small teapot')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/This wish was also changed somewhere else; your name replaced that\./)).toBeInTheDocument()
    const saved = await getItem(core.db, item.id)
    expect(saved?.title).toBe('Small teapot')
    // The other tab's notes were not overwritten with the notes this form loaded.
    expect(saved?.notes).toBe('Green, please')
  })
})

describe('editing list details in two places', () => {
  it('saves only the changed detail; an untouched field follows the other tab', async () => {
    const core = testCore()
    const user = userEvent.setup()
    const list = await createSharedList(core, { name: 'Birthday', message: 'Thanks!' })
    await openAt(core, `#/list/${list.id}`, 'Birthday')
    // Another tab changes the message; this form's message field follows it, since it was not touched here.
    await updateSharedList(core, list.id, { message: 'Thank you so much' })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message to friends (optional)' })).toHaveValue('Thank you so much'))
    const name = screen.getByRole('textbox', { name: 'List name' })
    await user.clear(name)
    await user.type(name, 'Birthday 2027')
    await user.click(screen.getByRole('button', { name: 'Save details' }))
    await screen.findByText('Details saved.')
    const saved = (await listSharedLists(core.db))[0]
    expect(saved?.name).toBe('Birthday 2027')
    expect(saved?.message).toBe('Thank you so much')
  })
})

describe('Home', () => {
  it('has no Settings button of its own: Settings is in the bottom navigation', async () => {
    const core = testCore()
    await setOnboarding(core.db, toStored({ ...newFlow(), status: 'completed' }, 1))
    await openAt(core, '#/', /Make a wishlist/)
    expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: 'Main' })).toContainElement(screen.getByRole('link', { name: 'Settings' }))
  })
})

describe('unsaved drafts', () => {
  it('keeps typing in "Add a wish" across leaving and reopening the form in the same tab, until Start over', async () => {
    const core = testCore()
    const user = userEvent.setup()
    const first = await openAt(core, '#/item/new', 'Add a wish')
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Cosy socks')
    await waitFor(() => expect(sessionStorage.getItem('hippo:draft:item:new')).toContain('Cosy socks'))
    first.unmount()

    await openAt(core, '#/item/new', 'Add a wish')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Cosy socks')
    expect(screen.getByText('Your unsaved changes are back.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('')
    expect(sessionStorage.getItem('hippo:draft:item:new')).toBeNull()
    expect(localStorage.getItem('hippo:draft:item:new')).toBeNull()
  })

  it('clears the draft when the wish is saved', async () => {
    const core = testCore()
    const user = userEvent.setup()
    await openAt(core, '#/item/new', 'Add a wish')
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Kettle')
    await user.click(screen.getByRole('button', { name: 'Add to wishlist' }))
    await screen.findByRole('heading', { level: 1, name: 'Wishlist' })
    expect(sessionStorage.getItem('hippo:draft:item:new')).toBeNull()
  })

  it('ignores a damaged draft', async () => {
    const core = testCore()
    sessionStorage.setItem('hippo:draft:item:new', JSON.stringify({ form: { title: 5 }, base: {}, currencyPicked: 'x' }))
    await openAt(core, '#/item/new', 'Add a wish')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('')
    expect(screen.queryByText('Your unsaved changes are back.')).toBeNull()
  })
})

describe('prices and currencies', () => {
  it('builds the example from the currency minor units', () => {
    expect(priceExample('USD')).toBe('24.99')
    expect(priceExample('JPY')).toBe('2499')
    expect(priceExample('KWD')).toBe('24.990')
  })

  it('a deep-linked currency shows in the picker but only becomes the default when picked by hand', async () => {
    const core = testCore()
    const user = userEvent.setup()
    handleStartupCapture({ search: '?title=Lamp&price=12.500&currency=KWD', href: 'http://localhost/?x', hash: '' } as Location, { replaceState: () => undefined } as unknown as History)
    const view = await openAt(core, '#/item/new', 'Add a wish')
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveValue('KWD')
    await user.click(screen.getByRole('button', { name: 'Add to wishlist' }))
    await screen.findByRole('heading', { level: 1, name: 'Wishlist' })
    expect(localStorage.getItem('hippo:currency')).toBeNull()
    view.unmount()

    await openAt(core, '#/item/new', 'Add a wish')
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveValue('USD')
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Mug')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'JPY')
    await user.type(screen.getByRole('textbox', { name: 'Price' }), '12.5')
    await user.click(screen.getByRole('button', { name: 'Add to wishlist' }))
    expect(await screen.findByText('Enter a price like 2499, or leave it empty.')).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'Price' }))
    await user.type(screen.getByRole('textbox', { name: 'Price' }), '1500')
    await user.click(screen.getByRole('button', { name: 'Add to wishlist' }))
    await screen.findByRole('heading', { level: 1, name: 'Wishlist' })
    expect(localStorage.getItem('hippo:currency')).toBe('JPY')
  })

  it('drops a made-up currency from a deep link', async () => {
    const core = testCore()
    handleStartupCapture({ search: '?title=Lamp&price=12&currency=XYZ', href: 'http://localhost/?x', hash: '' } as Location, { replaceState: () => undefined } as unknown as History)
    await openAt(core, '#/item/new', 'Add a wish')
    expect(screen.getByRole('combobox', { name: 'Currency' })).not.toHaveValue('XYZ')
    expect(screen.queryByRole('option', { name: 'XYZ' })).toBeNull()
  })
})

describe('first-run setup', () => {
  it('Skip on the name step clears what was typed, so it is not used later', async () => {
    const core = testCore()
    const user = userEvent.setup()
    await openAt(core, '#/', /Make a wishlist/)
    await user.click(screen.getByRole('button', { name: 'Get started' }))
    await screen.findByRole('heading', { level: 1, name: /call you\?/ })
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Secret')
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(await screen.findByRole('heading', { level: 1, name: /^What is\s*the occasion\?/ })).toBeInTheDocument()
    expect((await getSettings(core.db)).ownerName).toBeUndefined()
  })

  it('an unknown step while setup is in progress goes to the current step', async () => {
    const core = testCore()
    await setOnboarding(core.db, toStored({ ...newFlow(), step: 'occasion' }, 1))
    await openAt(core, '#/welcome/nonsense', /the occasion\?/)
    expect(window.location.hash).toBe('#/welcome/occasion')
  })

  it('creates one list and one wish even when two tabs save at once', async () => {
    const core = testCore()
    const f = newFlow()
    await persistFlow(core.db, f, 1)
    const [a, b] = await Promise.all([ensureSetupList(core, f, { name: 'Birthday', eventDate: '' }), ensureSetupList(core, f, { name: 'Birthday', eventDate: '' })])
    expect(a).toBe(b)
    expect(await listSharedLists(core.db)).toHaveLength(1)
    // A tab that never saw the list id keeps it when it saves its progress.
    await persistFlow(core.db, reduceFlow(f, { type: 'answer', patch: { wish: 'Teapot' } }), 2)
    expect((await getSettings(core.db)).onboarding?.listId).toBe(a)
    const [w1, w2] = await Promise.all([ensureSetupWish(core, f, { title: 'Teapot' }), ensureSetupWish(core, f, { title: 'Teapot' })])
    expect(w1.itemId).toBe(w2.itemId)
    expect(await core.db.items.count()).toBe(1)
    expect((await listSharedLists(core.db))[0]?.itemIds).toEqual([w1.itemId])
  })

  it('the setup hint belongs to one database', () => {
    writeSetupHint(true, 'db-a')
    expect(readSetupHint('db-a')).toBe(true)
    expect(readSetupHint('db-b')).toBe(false)
  })
})

describe('backup and restore', () => {
  it('restores the owner name, link lookup and setup state, and opens Home instead of setup on a fresh device', async () => {
    const source = testCore()
    await setOwnerName(source.db, 'Ann')
    await setOnboarding(source.db, toStored({ ...newFlow(), status: 'completed' }, 1))
    await source.db.settings.put({ key: 'linkPreview', value: true })
    await createItem(source.db, { title: 'Teapot' })
    const file = JSON.parse(JSON.stringify(await exportData(source.db))) as unknown

    const fresh = testCore()
    await importData(fresh.db, file)
    const s = await getSettings(fresh.db)
    expect(s.ownerName).toBe('Ann')
    expect(s.onboarding?.status).toBe('completed')
    expect((await fresh.db.settings.get('linkPreview'))?.value).toBe(true)
    await openAt(fresh, '#/', /Your wishlist/)
  })

  it('a version 1 file still imports and still skips setup', async () => {
    const db = openDb(`v1-${Math.random()}`)
    const file = { format: 'hippo-export', version: 1, exportedAt: 1, items: [], categories: [], sharedLists: [], guestLists: [], retiredLists: [], settings: { theme: 'dark' } }
    const item = await createItem(db, { title: 'x' })
    await importData(db, { ...file, items: [item] })
    expect((await getSettings(db)).onboarding?.status).toBe('completed')
  })

  it('rejects a bad owner name or setting', async () => {
    const db = openDb(`bad-${Math.random()}`)
    const base = { format: 'hippo-export', version: 2, exportedAt: 1, items: [], categories: [], sharedLists: [], guestLists: [], retiredLists: [] }
    await expect(importData(db, { ...base, settings: { ownerName: 'x'.repeat(41) } })).rejects.toThrow()
    await expect(importData(db, { ...base, settings: { linkPreview: 'yes' } })).rejects.toThrow()
    await expect(importData(db, { ...base, settings: { setup: 'active' } })).rejects.toThrow()
  })
})

describe('clock notice', () => {
  function clockWith(offset: number | undefined): Clock & { set(o: number): void } {
    let value = offset
    const listeners = new Set<() => void>()
    return {
      now: () => Date.now() + (value ?? 0),
      offset: () => value,
      ready: () => Promise.resolve(),
      subscribe: (l) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
      set(o) {
        value = o
        for (const l of listeners) l()
      },
    }
  }

  it('says once, plainly, when the device clock is more than two minutes off, and nothing when it is fine', async () => {
    const clock = clockWith(30_000)
    const core = testCore({ clock })
    await setOnboarding(core.db, toStored({ ...newFlow(), status: 'completed' }, 1))
    const view = await openAt(core, '#/settings', 'Settings')
    expect(screen.queryByText(/clock on this device/)).toBeNull()
    act(() => clock.set(-3600_000))
    // Said in the toast, and kept at the top of the screen until dismissed.
    expect(await screen.findByRole('note', { name: 'Device clock' })).toHaveTextContent(clockNoticeText(-3600_000))
    expect(screen.getAllByText(clockNoticeText(-3600_000)).some((el) => el.closest('.toast'))).toBe(true)
    expect(clockNoticeText(-3600_000)).toBe(
      'The clock on this device is about 1 hour ahead. Hippo uses the correct time instead, so everyone sees the same gifts. You can fix the clock in your device settings.',
    )
    view.unmount()
    // Told once: not again on the next visit while the clock is still wrong.
    await openAt(core, '#/settings', 'Settings')
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText(/clock on this device/)).toBeNull()
  })
})
