import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createCore, MemoryTransport } from '../core/index.ts'
import { App } from './App.tsx'

function testCore() {
  return createCore({ dbName: `app-test-${Math.random()}`, transport: new MemoryTransport() })
}

describe('App shell', () => {
  beforeEach(() => {
    window.location.hash = '#/'
  })

  it('shows the first-run home and adds an item through the form', async () => {
    const user = userEvent.setup()
    render(<App core={testCore()} />)
    expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    await user.click(screen.getByRole('link', { name: 'Add' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Add a wish' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add to wishlist' }))
    expect(await screen.findByText('Give this wish a name.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInvalid()

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Teapot')
    await user.click(screen.getByRole('button', { name: 'Add to wishlist' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Wishlist' })).toBeInTheDocument()
    expect(await screen.findByText('Teapot')).toBeInTheDocument()
  })

  it('shows a helpful screen for a broken share link', async () => {
    window.location.hash = '#/l/not-a-link'
    render(<App core={testCore()} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'This link does not work' })).toBeInTheDocument()
  })
})
