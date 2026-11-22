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

  it('takes a new owner through setup and lands on Home with their wish and list', async () => {
    const user = userEvent.setup()
    render(<App core={testCore()} />)
    expect(await screen.findByRole('heading', { level: 1, name: /Make a wishlist/ })).toHaveAccessibleDescription('Step 1 of 5')
    await user.click(screen.getByRole('button', { name: 'Get started' }))

    expect(await screen.findByRole('heading', { level: 1, name: /What should we\s*call you\?/ })).toHaveAccessibleDescription('Step 2 of 5')
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Ann')
    expect(screen.getByText(/Ann\u2019s list/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { level: 1, name: /Ann, what is\s*the occasion\?/ })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Birthday' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { level: 1, name: /What is one thing\s*you would love for your birthday\?/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save wish' }))
    expect(await screen.findByText('Type a wish or paste a link, or skip this step.')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Your wish, or a link to it' }), 'Teapot')
    await user.click(screen.getByRole('button', { name: 'Save wish' }))

    expect(await screen.findByRole('heading', { level: 1, name: /Add wishes\s*from anywhere/ })).toBeInTheDocument()
    expect(await screen.findByText('\u201cTeapot\u201d is on your list Birthday.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    expect(await screen.findByRole('heading', { name: /Get set up/ }, { timeout: 3000 })).toBeInTheDocument()
    expect(await screen.findByText('Teapot')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Birthday/ })).toBeInTheDocument()
  })

  it('closing setup at step 1 lands on Home, and the Add form still works', async () => {
    const user = userEvent.setup()
    render(<App core={testCore()} />)
    await user.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(await screen.findByRole('heading', { name: /Get set up/ }, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    await user.click(screen.getByRole('link', { name: 'Add a wish' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Add a wish' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add to wishlist' }))
    expect(await screen.findByText('Give this wish a name.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInvalid()

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Teapot')
    await user.click(screen.getByRole('button', { name: 'Add to wishlist' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Wishlist' })).toBeInTheDocument()
    expect(await screen.findByText('Teapot')).toBeInTheDocument()
  })

  it('a deep-link capture opens the Add form, not setup', async () => {
    window.location.hash = '#/item/new'
    render(<App core={testCore()} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Add a wish' })).toBeInTheDocument()
  })

  it('shows a helpful screen for a broken share link', async () => {
    window.location.hash = '#/l/not-a-link'
    render(<App core={testCore()} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'This link does not work' })).toBeInTheDocument()
  })
})
