import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SegmentedControl } from './SegmentedControl.tsx'

type Layout = 'grid' | 'list' | 'map'
const OPTIONS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
  { value: 'map', label: 'Map' },
] as const

function Harness({ onChange }: { onChange?: (v: Layout) => void }) {
  const [v, setV] = useState<Layout>('grid')
  return (
    <SegmentedControl<Layout>
      label="Item layout"
      options={OPTIONS}
      value={v}
      onChange={(next) => {
        setV(next)
        onChange?.(next)
      }}
    />
  )
}

describe('SegmentedControl', () => {
  it('is a named radiogroup with the current value checked', () => {
    render(<Harness />)
    expect(screen.getByRole('radiogroup', { name: 'Item layout' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Grid' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'List' })).not.toBeChecked()
  })

  it('selects on click and reports the value', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Map' }))
    expect(onChange).toHaveBeenCalledWith('map')
    expect(screen.getByRole('radio', { name: 'Map' })).toBeChecked()
  })

  it('moves the selection with arrow keys', async () => {
    render(<Harness />)
    screen.getByRole('radio', { name: 'Grid' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('radio', { name: 'Grid' })).toBeChecked()
  })
})
