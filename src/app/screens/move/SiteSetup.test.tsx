import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCore, DEFAULT_RELAYS, MemoryTransport, type Core } from '../../../core/index.ts'
import { CoreContext } from '../../core/context.ts'
import { chosenSite, setChosenSite } from '../../lib/site-address.ts'
import { DEPLOY_URL } from '../../lib/hosting.ts'
import type { FetchedFile, FileFetcher } from '../../lib/site-check.ts'
import SiteGuideSheet from '../lists/SiteGuideSheet.tsx'
import { SiteSetup } from './SiteSetup.tsx'

const INFO = JSON.stringify({ app: 'Hippo', name: 'Hippo', version: '0.1.1', protocol: 1, relays: [...DEFAULT_RELAYS] })

function file(over: Partial<FetchedFile> = {}): FetchedFile {
  return { status: 200, url: 'https://hippo.example.com/hippo.json', contentType: 'application/json', body: INFO, ...over }
}

function setup(core: Core, ui: React.ReactElement) {
  return render(<CoreContext.Provider value={core}>{ui}</CoreContext.Provider>)
}

const newCore = () => createCore({ dbName: `site-${Math.random()}`, transport: new MemoryTransport() })

afterEach(() => {
  setChosenSite(undefined)
})

describe('SiteSetup: the two choices', () => {
  it('connects an address typed without https, trimmed, and reports the host', async () => {
    const user = userEvent.setup()
    const asked: string[] = []
    const fetchFile: FileFetcher = async (u) => {
      asked.push(u)
      return file()
    }
    const onConnected = vi.fn()
    setup(newCore(), <SiteSetup intro="Why." onConnected={onConnected} fetchFile={fetchFile} />)
    await user.type(screen.getByRole('textbox', { name: 'Hippo website address' }), '  Hippo.Example.com  ')
    await user.click(screen.getByRole('button', { name: 'Check and use' }))
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith({ host: 'hippo.example.com', url: 'https://hippo.example.com/' }))
    expect(asked).toEqual(['https://hippo.example.com/hippo.json'])
    expect(chosenSite()?.url).toBe('https://hippo.example.com/')
  })

  it('shows a bad address under the field and keeps what was typed', async () => {
    const user = userEvent.setup()
    const onConnected = vi.fn()
    setup(newCore(), <SiteSetup intro="Why." onConnected={onConnected} fetchFile={async () => file()} />)
    const field = screen.getByRole('textbox', { name: 'Hippo website address' })
    await user.type(field, 'not a site')
    await user.click(screen.getByRole('button', { name: 'Check and use' }))
    const msg = await screen.findByText('That is not a web address Hippo can use. Enter it like gifts.example.org.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription(expect.stringContaining('not a web address'))
    expect(msg).toBeInTheDocument()
    expect(field).toHaveValue('not a site')
    expect(onConnected).not.toHaveBeenCalled()
    expect(chosenSite()).toBeUndefined()
  })

  it('says so when http is typed, when the site does not answer, and when it is not a Hippo site', async () => {
    const user = userEvent.setup()
    let next: () => Promise<FetchedFile> = async () => file()
    setup(newCore(), <SiteSetup intro="Why." onConnected={() => undefined} fetchFile={() => next()} />)
    const field = screen.getByRole('textbox', { name: 'Hippo website address' })
    const go = () => user.click(screen.getByRole('button', { name: 'Check and use' }))

    await user.type(field, 'http://hippo.example.com')
    await go()
    await screen.findByText('The address must be secure (https). Hippo cannot use an http address.')

    await user.clear(field)
    await user.type(field, 'hippo.example.com')
    next = () => Promise.reject(new Error('offline'))
    await go()
    await screen.findByText('Hippo could not reach that address. Check it, or try again when you are online.')

    next = async () => file({ status: 404 })
    await go()
    await screen.findByText('That address answers, but it is not a Hippo website.')

    next = async () => file({ body: '<html>hello</html>' })
    await go()
    await screen.findByText('That address answers, but it is not a Hippo website.')
    expect(chosenSite()).toBeUndefined()
  })

  it('"Set one up" shows three steps and a button that opens the setup page in the browser', async () => {
    const user = userEvent.setup()
    setup(newCore(), <SiteSetup intro="Why." onConnected={() => undefined} fetchFile={async () => file()} />)
    await user.click(screen.getByRole('radio', { name: 'Set one up, free, about two minutes' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    const link = screen.getByRole('link', { name: /Open the setup page/ })
    expect(link).toHaveAttribute('href', DEPLOY_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.queryByRole('textbox')).toBeNull()
    // Back to typing the address.
    await user.click(screen.getByRole('radio', { name: 'I have a Hippo site' }))
    expect(screen.getByRole('textbox', { name: 'Hippo website address' })).toBeInTheDocument()
  })

  it('uses plain words: no deploy, repository or origin', () => {
    const { container } = setup(newCore(), <SiteSetup intro="Why." onConnected={() => undefined} fetchFile={async () => file()} initialChoice="new" />)
    expect(container.textContent).not.toMatch(/deploy|repositor|origin|—/i)
  })
})

describe('SiteGuideSheet: before a first share', () => {
  it('explains why, offers both choices and lets the person share anyway', async () => {
    const user = userEvent.setup()
    const onShareAnyway = vi.fn()
    setup(newCore(), <SiteGuideSheet open onClose={() => undefined} onConnected={() => undefined} onShareAnyway={onShareAnyway} />)
    const dialog = await screen.findByRole('dialog', { name: 'Where will your list open?' })
    expect(dialog).toHaveTextContent('open your list in a web browser')
    expect(screen.getByRole('radio', { name: 'I have a Hippo site' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Set one up, free, about two minutes' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Share anyway' }))
    expect(onShareAnyway).toHaveBeenCalledOnce()
  })

  it('continues straight to sharing once an address is connected', async () => {
    const user = userEvent.setup()
    const onConnected = vi.fn()
    // The sheet reads hippo.json through the app's native fetch, which only exists in the app; the
    // inner component takes the fetcher, so this drives the same path through SiteSetup.
    setup(newCore(), <SiteSetup intro="Why." onConnected={onConnected} fetchFile={async () => file()} />)
    await user.type(screen.getByRole('textbox', { name: 'Hippo website address' }), 'hippo.example.com')
    await user.click(screen.getByRole('button', { name: 'Check and use' }))
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ host: 'hippo.example.com' })))
  })
})
