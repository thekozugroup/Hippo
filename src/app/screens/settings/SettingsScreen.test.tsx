import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createCore, getLinkPreviewEnabled, LINK_PREVIEW_DISCLOSURE, MemoryTransport } from '../../../core/index.ts'
import { App } from '../../App.tsx'

describe('Settings: link lookup and deployment checks', () => {
  beforeEach(() => {
    window.location.hash = '#/settings'
  })

  it('has the lookup switch off, with the exact disclosure and the free service limits', async () => {
    const core = createCore({ dbName: `settings-${Math.random()}`, transport: new MemoryTransport() })
    const user = userEvent.setup()
    render(<App core={core} />)
    const sw = await screen.findByRole('switch', { name: 'Look up the title and picture of links' })
    await waitFor(() => expect(sw).toBeEnabled())
    expect(sw).not.toBeChecked()
    expect(sw).toHaveAccessibleDescription(`${LINK_PREVIEW_DISCLOSURE} The free service only handles a few lookups a day, and it returns a title and a picture, not a price.`)
    expect(screen.getByText(LINK_PREVIEW_DISCLOSURE)).toBeInTheDocument()

    await user.click(sw)
    await waitFor(async () => expect(await getLinkPreviewEnabled(core.db)).toBe(true))
    await waitFor(() => expect(sw).toBeChecked())
    await user.click(sw)
    await waitFor(async () => expect(await getLinkPreviewEnabled(core.db)).toBe(false))
    await waitFor(() => expect(sw).not.toBeChecked())
  })

  it('keeps the deployment checks collapsed, at the bottom, and does not run them until opened', async () => {
    const core = createCore({ dbName: `settings-${Math.random()}`, transport: new MemoryTransport() })
    render(<App core={core} />)
    const row = await screen.findByText('Deployment checks')
    expect(screen.getByRole('group')).not.toHaveAttribute('open')
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings[headings.length - 1]).toBe('About and privacy')
    expect(row.compareDocumentPosition(screen.getByRole('heading', { name: 'About and privacy' })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(screen.queryByText(/^Checking/)).toBeNull() // nothing has run
  })
})
