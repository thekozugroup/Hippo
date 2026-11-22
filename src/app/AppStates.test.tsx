import { render, screen, waitFor } from '@testing-library/react'
import { createCore, createItem, createSharedList, MemoryTransport, openDb, publishList, type Core } from '../core/index.ts'
import { App } from './App.tsx'
import { CoreProvider } from './core/CoreProvider.tsx'
import { ErrorBoundary } from './layout/ErrorBoundary.tsx'

function testCore(transport = new MemoryTransport()): Core {
  return createCore({ dbName: `app-states-${Math.random()}`, transport })
}

function Boom({ error }: { error: Error }): never {
  throw error
}

describe('owner list editor sharing state', () => {
  beforeEach(() => {
    window.location.hash = '#/'
  })

  it('shows "Not shared yet" and no link when no relay accepted the first publish', async () => {
    const transport = new MemoryTransport()
    const core = testCore(transport)
    const item = await createItem(core.db, { title: 'Kite' })
    const list = await createSharedList(core, { name: 'Kites', itemIds: [item.id] })
    transport.offline = true
    await publishList(core, list.id)
    window.location.hash = `#/list/${list.id}`
    render(<App core={core} />)
    expect(await screen.findByText('Hippo could not reach the sync servers, so the link would not work yet.', { exact: false })).toBeInTheDocument()
    expect(screen.getAllByText('Not shared yet').length).toBeGreaterThan(0)
    expect(screen.queryByRole('textbox', { name: 'Share link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again now' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Your list - Hippo'))
  })

  it('offers the link once a relay has the list', async () => {
    const core = testCore()
    const item = await createItem(core.db, { title: 'Kite' })
    const list = await createSharedList(core, { name: 'Kites', itemIds: [item.id] })
    await publishList(core, list.id)
    window.location.hash = `#/list/${list.id}`
    render(<App core={core} />)
    expect(await screen.findByRole('textbox', { name: 'Share link' })).toBeInTheDocument()
    expect(screen.getByText('Shared')).toBeInTheDocument()
    expect(screen.queryByText('Not shared yet')).toBeNull()
  })
})

describe('document titles', () => {
  it('names each route without list names or link data', async () => {
    window.location.hash = '#/'
    render(<App core={testCore()} />)
    await waitFor(() => expect(document.title).toBe('Home - Hippo'))
    window.location.hash = '#/l/AAAAsecret'
    expect(await screen.findByRole('heading', { level: 1, name: 'This link does not work' })).toBeInTheDocument()
    expect(document.title).toBe('Opening a shared list - Hippo')
    expect(document.title).not.toContain('AAAA')
  })
})

describe('storage problems and render errors', () => {
  beforeEach(() => {
    window.location.hash = '#/'
  })

  it('explains when the database cannot be opened instead of loading forever', async () => {
    const db = openDb(`broken-${Math.random()}`)
    const failure = Object.assign(new Error('blocked'), { name: 'OpenFailedError' })
    db.open = (() => Promise.reject(failure)) as typeof db.open
    render(<App core={createCore({ db, transport: new MemoryTransport() })} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Hippo cannot save on this device' })).toBeInTheDocument()
    expect(screen.getByText(/private or incognito browsing/)).toBeInTheDocument()
    expect(document.title).toBe('Cannot save on this device - Hippo')
  })

  it('shows a recovery screen with reload and backup when a screen fails to render', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(
      <CoreProvider core={testCore()}>
        <ErrorBoundary>
          <Boom error={new Error('render bug')} />
        </ErrorBoundary>
      </CoreProvider>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload Hippo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save a backup' })).toBeInTheDocument()
    spy.mockRestore()
    warn.mockRestore()
  })

  it('shows the storage screen when a render error comes from the database', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(
      <CoreProvider core={testCore()}>
        <ErrorBoundary>
          <Boom error={Object.assign(new Error('gone'), { name: 'DatabaseClosedError' })} />
        </ErrorBoundary>
      </CoreProvider>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Hippo cannot save on this device' })).toBeInTheDocument()
    spy.mockRestore()
    warn.mockRestore()
  })
})
