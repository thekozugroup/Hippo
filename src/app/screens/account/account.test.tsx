import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createCore, createItem, MemoryTransport, type Core } from '../../../core/index.ts'
import { accountSummary, ensureAccount, markRecoveryCodeSaved } from '../../../core/account/service.ts'
import { formatRecoveryCode, parseRecoveryCode, recoveryWords } from '../../../core/account/recovery-code.ts'
import { getAccountState } from '../../../core/account/state.ts'
import { App } from '../../App.tsx'
import { codeProblemText, recoveryFileText, statusLine } from './account-text.ts'
import { applySiteOverrideFromUrl, builtSiteAddress, movedSiteFor, SITE_TEST_STORAGE_KEY } from './address.ts'

// The engine is exercised in src/core; here every screen only needs to ask for it.
vi.mock('../../core/account.ts', () => ({ startAccountSync: vi.fn(async () => undefined), bootAccount: vi.fn(), resumeAccount: vi.fn() }))

function newCore(): Core {
  return createCore({ dbName: `account-${Math.random()}`, transport: new MemoryTransport() })
}

describe('account wording', () => {
  it('says plainly whether this device is in step', () => {
    const base = { phase: 'on' as const, unsent: 0, waitingForFirstSync: false }
    const now = Date.UTC(2026, 10, 24, 15, 0)
    expect(statusLine({ ...base, lastSyncAt: now - 60_000 }, { offline: false, syncing: false }, now, 'en-GB').text).toMatch(/^Up to date\. Last synced \d/)
    expect(statusLine({ ...base, unsent: 2 }, { offline: true, syncing: false }, now).text).toBe('Waiting for a connection. 2 changes will be sent then.')
    expect(statusLine({ ...base, unsent: 1 }, { offline: false, syncing: false }, now).text).toBe('Sending 1 change…')
    expect(statusLine({ ...base, phase: 'off' }, { offline: false, syncing: false }, now).tone).toBe('off')
    expect(statusLine({ ...base, phase: 'replaced' }, { offline: false, syncing: false }, now).text).toContain('Sign in again with the new code')
    expect(statusLine({ ...base, waitingForFirstSync: true }, { offline: true, syncing: false }, now).text).toBe('Waiting for a connection to bring your wishes here.')
    for (const r of [parseRecoveryCode(''), parseRecoveryCode('apple'), parseRecoveryCode('zzzz '.repeat(13))]) {
      if (r.ok) throw new Error('expected a problem')
      expect(codeProblemText(r)).not.toMatch(/—/)
    }
    const words = recoveryWords('00112233445566778899aabbccddeeff')
    expect(recoveryFileText(words, 'https://hippo.example/')).toContain(' 1. ' + words[0])
  })

  it('finds a moved site by origin, and takes the test stand-in only on loopback', () => {
    expect(movedSiteFor('https://old.vercel.app', 'https://hippo.example/')).toBe('https://hippo.example/')
    expect(movedSiteFor('https://hippo.example', 'https://hippo.example/app/')).toBeUndefined()
    expect(movedSiteFor('https://x.example', '')).toBeUndefined()
    expect(movedSiteFor('https://x.example', 'http://evil.example/')).toBeUndefined()
    const store = new Map<string, string>()
    const fake = { setItem: (k: string, v: string) => store.set(k, v) }
    applySiteOverrideFromUrl('https://hippo.example/?site=http://localhost:5/', fake)
    expect(store.size).toBe(0)
    applySiteOverrideFromUrl('http://127.0.0.1:5/hippo/?site=https://evil.example/', fake)
    expect(store.size).toBe(0)
    applySiteOverrideFromUrl('http://127.0.0.1:5/hippo/?site=http://localhost:5/hippo/', fake)
    expect(store.get(SITE_TEST_STORAGE_KEY)).toBe('http://localhost:5/hippo/')
    sessionStorage.setItem(SITE_TEST_STORAGE_KEY, 'http://localhost:5/hippo/')
    expect(builtSiteAddress({ href: 'https://hippo.example/' })).toBe('')
  })
})

describe('account screens', () => {
  it('"I already use Hippo" offers the recovery code and a device link before the backup file', async () => {
    window.location.hash = '#/existing'
    render(<App core={newCore()} />)
    const list = await screen.findByRole('list')
    const titles = within(list)
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '')
    expect(titles[0]).toContain('Sign in with my recovery code')
    expect(titles[1]).toContain('I have a link from my other device')
    expect(titles[2]).toContain('From a backup file')
  })

  it('shows the recovery code, which turns the account on, and records that it was saved', async () => {
    const core = newCore()
    const user = userEvent.setup()
    window.location.hash = '#/account/code'
    render(<App core={core} />)
    const list = await screen.findByTestId('recovery-code')
    const words = within(list).getAllByRole('listitem').map((li) => li.textContent?.replace(/^\d+/, '') ?? '')
    expect(words).toHaveLength(13)
    const st = await getAccountState(core.db)
    expect(st?.sync).toBe(true)
    expect(words.join(' ')).toBe(formatRecoveryCode(st?.secret ?? ''))
    expect(screen.getByText(/Hippo cannot recover it for you/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save as a file' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'I have saved it' }))
    await waitFor(async () => expect((await accountSummary(core.db)).recoverySavedAt).toBeDefined())
  })

  it('signs in with a typed code, catching a typo first', async () => {
    const core = newCore()
    const user = userEvent.setup()
    window.location.hash = '#/account/sign-in'
    render(<App core={core} />)
    const field = await screen.findByRole('textbox', { name: 'Recovery code' })
    const secret = '00112233445566778899aabbccddeeff'
    const words = recoveryWords(secret)
    const typo = [...words]
    typo[3] = words[3] === 'zoo' ? 'wolf' : 'zoo'
    await user.type(field, typo.join(' '))
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/do not add up to a recovery code/)).toBeInTheDocument()
    expect(field).toHaveValue(typo.join(' ')) // what was typed is kept
    expect(await getAccountState(core.db)).toBeUndefined()
    await user.clear(field)
    await user.type(field, words.join(' '))
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(async () => expect((await getAccountState(core.db))?.secret).toBe(secret))
    await waitFor(() => expect(window.location.hash).toBe('#/'))
  })

  it('Settings: offers adding a device before an account exists, then shows its state and signs out keeping this copy', async () => {
    const core = newCore()
    const user = userEvent.setup()
    window.location.hash = '#/settings'
    const { unmount } = render(<App core={core} />)
    expect(await screen.findByRole('heading', { name: 'Your devices' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add a device' })).toHaveAttribute('href', '#/move')
    expect(screen.getByRole('link', { name: 'Sign in with a code' })).toHaveAttribute('href', '#/account/sign-in')
    unmount()

    await ensureAccount(core)
    await createItem(core.db, { title: 'Kite' }, core.now())
    render(<App core={core} />)
    expect(await screen.findByTestId('account-status')).toBeInTheDocument()
    expect(screen.getByText(/Save your recovery code\. Without it/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Sync on this device' })).toBeChecked()
    expect(screen.getByText(/no accounts in the usual sense and cannot reset anything/)).toBeInTheDocument()
    await markRecoveryCodeSaved(core)
    await waitFor(() => expect(screen.queryByText(/Save your recovery code\. Without it/)).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Sign out on this device' }))
    await user.click(await screen.findByRole('button', { name: 'Sign out, keep this copy' }))
    await waitFor(async () => expect(await getAccountState(core.db)).toBeUndefined())
    expect(await core.db.items.count()).toBe(1)
  })

  it('Settings: signing out can remove this device copy', async () => {
    const core = newCore()
    const user = userEvent.setup()
    await ensureAccount(core)
    await createItem(core.db, { title: 'Kite' }, core.now())
    window.location.hash = '#/settings'
    render(<App core={core} />)
    await user.click(await screen.findByRole('button', { name: 'Sign out on this device' }))
    await user.click(await screen.findByRole('button', { name: 'Sign out and remove this copy' }))
    await waitFor(async () => expect(await core.db.items.count()).toBe(0))
    expect(await getAccountState(core.db)).toBeUndefined()
  })

  it('Home: the checklist asks for the recovery code, and the address notice shows only with own data on another address', async () => {
    const core = newCore()
    await core.db.settings.put({ key: 'onboarding', value: { status: 'completed', step: 0, answers: {}, updatedAt: 1 } })
    await createItem(core.db, { title: 'Kite' }, core.now())
    sessionStorage.setItem(SITE_TEST_STORAGE_KEY, 'http://127.0.0.1:9/hippo/')
    window.location.hash = '#/'
    render(<App core={core} />)
    expect(await screen.findByRole('link', { name: /Save your recovery code/ })).toHaveAttribute('href', '#/account/code')
    // jsdom's page is on localhost, a different origin from the stand-in.
    expect(await screen.findByRole('heading', { name: 'This Hippo site now lives at 127.0.0.1:9' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to 127.0.0.1:9' })).toBeInTheDocument()
  })

  it('Home: no address notice for someone who only opened a shared list', async () => {
    const core = newCore()
    await core.db.settings.put({ key: 'onboarding', value: { status: 'completed', step: 0, answers: {}, updatedAt: 1 } })
    sessionStorage.setItem(SITE_TEST_STORAGE_KEY, 'http://127.0.0.1:9/hippo/')
    window.location.hash = '#/'
    render(<App core={core} />)
    await screen.findByRole('heading', { level: 1 })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('site-notice')).toBeNull()
  })
})
