import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { EXPANDED_QUERY, MEDIUM_QUERY } from './layout.ts'
import { SideNav } from './components/SideNav.tsx'
import { StepScreen } from './components/StepScreen.tsx'

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return name.endsWith('.css') ? [path] : []
  })
}

describe('size classes', () => {
  it('every stylesheet writes the medium and expanded queries exactly as layout.ts does', () => {
    const files = cssFiles(join(process.cwd(), 'src'))
    let seen = 0
    for (const file of files) {
      const css = readFileSync(file, 'utf8')
      for (const m of css.matchAll(/@media ([^{]*(?:45em|67\.5em)[^{]*)\{/g)) {
        seen += 1
        const query = (m[1] ?? '').trim()
        expect([MEDIUM_QUERY, EXPANDED_QUERY], `${file}: ${query}`).toContain(query)
      }
    }
    expect(seen).toBeGreaterThan(10)
  })
})

describe('SideNav', () => {
  const items = [
    { id: 'home', label: 'Home', icon: <svg />, href: '#/' },
    { id: 'lists', label: 'Lists', icon: <svg />, href: '#/lists' },
  ]
  it('is one navigation landmark: the Hippo mark, the action, then the destinations, the current one marked', () => {
    render(<SideNav items={items} activeId="lists" homeHref="#/" action={{ label: 'Add a wish', icon: <svg />, href: '#/item/new' }} />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const links = Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('aria-label') ?? a.textContent)
    expect(links).toEqual(['Hippo home', 'Add a wish', 'Home', 'Lists'])
    expect(screen.getByRole('link', { name: 'Lists' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Add a wish' })).toHaveAttribute('href', '#/item/new')
  })
  it('marks nothing when the screen is not a destination', () => {
    render(<SideNav items={items} homeHref="#/" />)
    expect(document.querySelector('[aria-current]')).toBeNull()
  })
})

describe('StepScreen continue control', () => {
  it('is an ordinary button unless the step asks for the slide control; Enter in a field continues', async () => {
    const user = userEvent.setup()
    let n = 0
    const { rerender } = render(
      <StepScreen contained step={2} total={5} title="Name" continueLabel="Continue" onContinue={() => (n += 1)}>
        <input aria-label="Your name" />
      </StepScreen>,
    )
    expect(document.querySelector('.slide-btn')).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('btn--primary')
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Ann{Enter}')
    expect(n).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(n).toBe(2)
    rerender(<StepScreen contained step={1} total={5} title="Start" continueLabel="Get started" continueStyle="slide" onContinue={() => (n += 1)} />)
    expect(document.querySelector('.slide-btn')).not.toBeNull()
  })
  it('says it is saving while busy and ignores presses', async () => {
    const user = userEvent.setup()
    let n = 0
    render(<StepScreen contained step={3} total={5} title="Wish" continueLabel="Save wish" busy onContinue={() => (n += 1)} />)
    const btn = screen.getByRole('button', { name: 'Saving…' })
    expect(btn).toHaveAttribute('aria-busy', 'true')
    await user.click(btn)
    expect(n).toBe(0)
  })
})
