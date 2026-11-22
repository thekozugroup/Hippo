import { createRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BottomSheet } from './BottomSheet.tsx'
import { Button, LinkButton } from './Button.tsx'
import { List } from './List.tsx'
import { ListRow } from './ListRow.tsx'
import { MoneyField } from './MoneyField.tsx'
import { MoneyText } from './MoneyText.tsx'
import { Select } from './Select.tsx'
import { TextArea } from './TextArea.tsx'
import { TextField } from './TextField.tsx'
import { Thumb } from './Thumb.tsx'
import { Chip } from './Chip.tsx'
import { BottomNav } from './BottomNav.tsx'
import { DotProgress } from './DotProgress.tsx'
import { moneyParts } from './money.ts'

describe('MoneyText never throws on untrusted data', () => {
  it('formats a known currency normally', () => {
    render(<MoneyText money={{ amount: 24900, currency: 'USD' }} locale="en-US" />)
    expect(screen.getByText('$249.00')).toBeInTheDocument()
  })

  it.each(['', 'XX', 'US', '12', 'not a code', '\u0000\u0001'])('falls back to a plain number plus the code for %j', (code) => {
    expect(() => render(<MoneyText money={{ amount: 12345, currency: code }} locale="en-US" />)).not.toThrow()
    const text = document.body.textContent ?? ''
    expect(text).toContain('123.45')
  })

  it('shows the code as text for an unknown currency', () => {
    render(<MoneyText money={{ amount: 500, currency: 'XX' }} locale="en-US" />)
    expect(screen.getByText(/5\.00\s*XX/)).toBeInTheDocument()
  })

  it.each([NaN, Infinity, -Infinity])('renders a dash for the non-finite amount %s', (amount) => {
    expect(() => render(<MoneyText money={{ amount, currency: 'USD' }} />)).not.toThrow()
    expect(document.body.textContent).toContain('—')
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|∞/)
  })

  it('survives an invalid locale', () => {
    expect(() => render(<MoneyText money={{ amount: 100, currency: 'USD' }} locale="not_a_locale!!" />)).not.toThrow()
  })

  it('keeps muted fractions for known currencies and uses plain parts for unknown ones', () => {
    const { container } = render(<MoneyText money={{ amount: 11745017, currency: 'USD' }} locale="en-US" muteFraction />)
    expect(container.querySelectorAll('.money__fraction').length).toBeGreaterThan(0)
    expect(moneyParts(1, 'XX', 'en-US').some((p) => p.type === 'currency' && p.value === 'XX')).toBe(true)
  })

  it('MoneyField renders and announces the currency for unknown codes', () => {
    expect(() => render(<MoneyField label="Price" currency="XX" />)).not.toThrow()
    expect(screen.getByRole('textbox', { name: 'Price' })).toHaveAccessibleDescription('XX')
  })
})

describe('fields forward refs and merge ARIA', () => {
  it('TextField, TextArea and Select forward ref to the native control', () => {
    const a = createRef<HTMLInputElement>()
    const b = createRef<HTMLTextAreaElement>()
    const c = createRef<HTMLSelectElement>()
    render(
      <>
        <TextField label="A" ref={a} />
        <TextArea label="B" ref={b} />
        <Select label="C" ref={c}>
          <option>x</option>
        </Select>
      </>,
    )
    expect(a.current).toBe(screen.getByRole('textbox', { name: 'A' }))
    expect(b.current).toBe(screen.getByRole('textbox', { name: 'B' }))
    expect(c.current).toBe(screen.getByRole('combobox', { name: 'C' }))
  })

  it('merges a caller aria-describedby with the hint and error ids', () => {
    render(
      <>
        <p id="extra">Extra help</p>
        <TextField label="Name" hint="Shown to friends" error="Required" aria-describedby="extra" />
      </>,
    )
    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toHaveAccessibleDescription('Required Shown to friends Extra help')
    expect(input).toBeInvalid()
  })

  it('keeps a caller aria-invalid when there is no error text', () => {
    render(<TextField label="Name" aria-invalid="true" />)
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInvalid()
  })

  it('forwards ref and native props on Button, LinkButton, ListRow, Chip and BottomNav', () => {
    const btn = createRef<HTMLButtonElement>()
    render(
      <>
        <Button ref={btn} data-x="1">
          Go
        </Button>
        <List data-testid="list">
          <ListRow title="Row" data-row="r" />
        </List>
        <Chip data-chip="c" selected={false} onClick={() => undefined}>
          Chip
        </Chip>
        <BottomNav data-nav="n" items={[{ id: 'a', label: 'A', icon: <svg />, href: '#a' }]} activeId="a" />
        <DotProgress label="p" value={0.5} data-dp="d" />
      </>,
    )
    expect(btn.current).toBe(screen.getByRole('button', { name: 'Go' }))
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('data-x', '1')
    expect(screen.getByTestId('list')).toHaveAttribute('role', 'list')
    expect(document.querySelector('li')).toHaveAttribute('data-row', 'r')
    expect(screen.getByRole('button', { name: 'Chip' })).toHaveAttribute('data-chip', 'c')
    expect(screen.getByRole('navigation')).toHaveAttribute('data-nav', 'n')
    expect(document.querySelector('.dot-progress')).toHaveAttribute('data-dp', 'd')
  })

  it('LinkButton ignores activation while loading', async () => {
    const onClick = vi.fn()
    render(
      <LinkButton href="#x" loading onClick={onClick}>
        Open
      </LinkButton>,
    )
    const link = screen.getByRole('link', { name: 'Open' })
    expect(link).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(link)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Thumb', () => {
  it('always renders the letter tile and drops a broken image', () => {
    render(<Thumb name="duvet" src="./missing.jpg" alt="Duvet" />)
    const img = screen.getByAltText('Duvet')
    expect(screen.getByText('D')).toBeInTheDocument()
    fireEvent.error(img)
    expect(screen.queryByAltText('Duvet')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Duvet' })).toBeInTheDocument()
    expect(screen.getByText('D')).toBeInTheDocument()
  })

  it('hides the letter once the image has loaded and retries when src changes', () => {
    const { rerender, container } = render(<Thumb name="duvet" src="a.jpg" />)
    fireEvent.load(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('.thumb')).toHaveClass('is-loaded')
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()
    rerender(<Thumb name="duvet" src="b.jpg" />)
    expect(container.querySelector('img')).not.toBeNull()
    expect(container.querySelector('.thumb')).not.toHaveClass('is-loaded')
  })
})

describe('ListRow', () => {
  it('keeps the full title in the DOM and clamps by default', () => {
    render(
      <List>
        <ListRow title="A very long title that wraps over several lines and is only clipped visually" />
      </List>,
    )
    expect(screen.getByText(/only clipped visually/)).toBeInTheDocument()
    expect(document.querySelector('li')).toHaveAttribute('data-lines', '2')
  })
})

describe('BottomSheet close sync', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  })

  function Harness({ onClosed }: { onClosed?: () => void }) {
    const [open, setOpen] = useState(true)
    return (
      <>
        <span data-testid="state">{open ? 'open' : 'closed'}</span>
        <BottomSheet
          open={open}
          title="Sheet"
          onClose={() => {
            setOpen(false)
            onClosed?.()
          }}
        >
          <input aria-label="inside" />
        </BottomSheet>
      </>
    )
  }

  it('tells the owner when the browser closes the dialog on its own', () => {
    const onClosed = vi.fn()
    render(<Harness onClosed={onClosed} />)
    const dialog = document.querySelector('dialog') as HTMLDialogElement
    expect(screen.getByTestId('state')).toHaveTextContent('open')
    // Native close, not caused by React state (for example a second Escape press).
    dialog.removeAttribute('open')
    fireEvent(dialog, new Event('close'))
    expect(onClosed).toHaveBeenCalledOnce()
    expect(screen.getByTestId('state')).toHaveTextContent('closed')
  })

  it('does not report its own programmatic close as a dismissal', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <BottomSheet open title="Sheet" onClose={onClose}>
        x
      </BottomSheet>,
    )
    rerender(
      <BottomSheet open={false} title="Sheet" onClose={onClose}>
        x
      </BottomSheet>,
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on a backdrop click but not when the press started inside the sheet', () => {
    const onClosed = vi.fn()
    render(<Harness onClosed={onClosed} />)
    const dialog = document.querySelector('dialog') as HTMLDialogElement
    const input = screen.getByLabelText('inside')
    // Press inside, release on the backdrop (a text-selection drag).
    fireEvent.pointerDown(input, { bubbles: true })
    fireEvent.click(dialog)
    expect(onClosed).not.toHaveBeenCalled()
    // A real backdrop click.
    fireEvent.pointerDown(dialog)
    fireEvent.click(dialog)
    expect(onClosed).toHaveBeenCalledOnce()
  })

  it('has no decorative grab handle', () => {
    render(<Harness />)
    expect(document.querySelector('.bottom-sheet__grab')).toBeNull()
  })
})
