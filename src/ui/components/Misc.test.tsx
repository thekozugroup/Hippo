import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Chip } from './Chip.tsx'
import { IconButton, IconLink } from './IconButton.tsx'
import { ImportanceMark } from './ImportanceMark.tsx'
import { MoneyText } from './MoneyText.tsx'
import { StatusPill } from './StatusPill.tsx'
import { TextField } from './TextField.tsx'
import { Thumb } from './Thumb.tsx'
import { BottomNav } from './BottomNav.tsx'

describe('small components', () => {
  it('IconButton is named by aria-label', () => {
    render(<IconButton aria-label="Open menu" icon={<svg />} />)
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
  })

  it('StatusPill always carries a text label', () => {
    render(<StatusPill status="partial" />)
    expect(screen.getByText('Partly funded')).toBeInTheDocument()
  })

  it('Chip toggles aria-pressed when selectable', async () => {
    const onClick = vi.fn()
    render(
      <Chip selected onClick={onClick}>
        Claimed
      </Chip>,
    )
    const chip = screen.getByRole('button', { name: 'Claimed' })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(chip)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('MoneyText formats minor units with the currency exponent', () => {
    const { container } = render(
      <>
        <MoneyText money={{ amount: 24900, currency: 'USD' }} locale="en-US" />
        <MoneyText money={{ amount: 1200, currency: 'JPY' }} locale="en-US" />
      </>,
    )
    expect(container.textContent).toBe('$249.00¥1,200')
  })

  it('Thumb falls back to the first letter and hides it when decorative', () => {
    render(<Thumb name="espresso" />)
    const fallback = screen.getByText('E')
    expect(fallback).toHaveAttribute('aria-hidden', 'true')
  })

  it('TextField links label, hint and error to the input', () => {
    render(<TextField label="Name" hint="Shown to friends" error="Required" />)
    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toBeInvalid()
    expect(input).toHaveAccessibleDescription('Required Shown to friends')
  })

  it('BottomNav marks the active destination with aria-current', () => {
    render(
      <BottomNav
        label="Main"
        activeId="lists"
        items={[
          { id: 'home', label: 'Home', icon: <svg />, href: '#/' },
          { id: 'lists', label: 'Lists', icon: <svg />, href: '#/lists' },
        ]}
      />,
    )
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lists' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('IconLink is a named link with the icon-button look', () => {
    render(<IconLink href="#/" aria-label="Back to home" icon={<svg />} />)
    const link = screen.getByRole('link', { name: 'Back to home' })
    expect(link).toHaveAttribute('href', '#/')
    expect(link).toHaveClass('icon-btn')
  })

  it('ImportanceMark uses the PRD FR-2 labels', () => {
    const { container } = render(
      <>
        <ImportanceMark level={1} />
        <ImportanceMark level={2} />
        <ImportanceMark level={3} />
      </>,
    )
    expect(container.textContent).toBe('Nice to haveWantWould love')
  })
})
