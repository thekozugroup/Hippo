import type { ReactNode } from 'react'
import { cx } from '../cx.ts'
import './StatCard.css'

export interface StatCardProps {
  /** Quiet uppercase label. */
  label: string
  /** Small trailing slot, usually a decorative icon or an `IconButton`. */
  action?: ReactNode
  /** Bar heights from 0 to 1 for the mini graphic (decorative). */
  bars?: ReadonlyArray<number>
  /** Inclusive index range of highlighted bars. */
  highlight?: readonly [number, number]
  /** The value, usually a `BigValue` or `MoneyText`. */
  value: ReactNode
  /** Small caption under the value. */
  caption?: ReactNode
  /** Panel look: frosted card for the dark theme. */
  panel?: boolean
  className?: string
}

/** Tile with a label, a mini bar graphic, a value and a caption. */
export function StatCard({ label, action, bars, highlight, value, caption, panel, className }: StatCardProps) {
  return (
    <article className={cx('stat-card', panel && 'frost frost--panel', className)}>
      <header className="stat-card__head">
        <h3 className="stat-card__label">{label}</h3>
        {action ? <div className="stat-card__action">{action}</div> : null}
      </header>
      {bars ? (
        <div className="stat-card__bars" aria-hidden="true">
          {bars.map((h, i) => (
            <span
              key={i}
              className={cx('stat-card__bar', highlight && i >= highlight[0] && i <= highlight[1] && 'is-on')}
              style={{ height: `${Math.round(Math.min(1, Math.max(0.08, h)) * 100)}%` }}
            />
          ))}
        </div>
      ) : null}
      <div className="stat-card__value">{value}</div>
      {caption ? <p className="stat-card__caption">{caption}</p> : null}
    </article>
  )
}
