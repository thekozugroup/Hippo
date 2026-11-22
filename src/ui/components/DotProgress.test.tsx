import { render, screen } from '@testing-library/react'
import { DotProgress } from './DotProgress.tsx'

describe('DotProgress', () => {
  it('is a progressbar with a name and percentage', () => {
    render(<DotProgress label="Funding for Espresso machine" value={0.6} />)
    const bar = screen.getByRole('progressbar', { name: 'Funding for Espresso machine' })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuenow', '60')
    expect(bar).toHaveAttribute('aria-valuetext', '60%')
  })

  it('uses a custom text alternative when given', () => {
    render(<DotProgress label="Funding" value={0.35} valueText="$70 of $200" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '$70 of $200')
  })

  it('clamps out-of-range and non-finite values', () => {
    const { rerender } = render(<DotProgress label="p" value={2} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    rerender(<DotProgress label="p" value={-1} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    rerender(<DotProgress label="p" value={Number.NaN} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('fills the matching share of dots across two rows', () => {
    const { container } = render(<DotProgress label="p" value={0.5} columns={10} />)
    expect(container.querySelectorAll('.dot-progress__dot')).toHaveLength(20)
    expect(container.querySelectorAll('.dot-progress__dot.is-on')).toHaveLength(10)
  })

  it('hides the dots from assistive tech and shows no percentage beside the bar', () => {
    const { container } = render(<DotProgress label="p" value={0.5} />)
    expect(container.querySelector('.dot-progress__dot')).toHaveAttribute('aria-hidden', 'true')
    expect(container.textContent).toBe('')
  })

  it('never shows a nearly complete bar as full, or a small start as empty', () => {
    const { container, rerender } = render(<DotProgress label="p" value={0.99} columns={10} />)
    expect(container.querySelectorAll('.dot-progress__dot.is-on')).toHaveLength(18)
    rerender(<DotProgress label="p" value={0.01} columns={10} />)
    expect(container.querySelectorAll('.dot-progress__dot.is-on')).toHaveLength(2)
  })
})
