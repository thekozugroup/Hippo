import type { ComponentPropsWithRef, MouseEventHandler, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './ListRow.css'

export interface ListRowProps extends Omit<ComponentPropsWithRef<'li'>, 'title' | 'onClick' | 'children'> {
  /** Leading visual, usually a `Thumb`. */
  leading?: ReactNode
  /** Primary text. */
  title: ReactNode
  /** Secondary line. */
  secondary?: ReactNode
  /** Trailing value or status. */
  trailing?: ReactNode
  /** Makes the row a link. */
  href?: string
  /** Makes the row a button (or adds a handler to the link). */
  onClick?: MouseEventHandler<HTMLElement>
  /** Maximum lines for the title and secondary text before they are clipped; the full text stays in the DOM. Default 2. */
  lines?: 1 | 2 | 'full'
}

/** One row of a `List`: leading visual, title, secondary line and trailing value. */
export function ListRow({ leading, title, secondary, trailing, href, onClick, lines = 2, className, ...rest }: ListRowProps) {
  const body = (
    <>
      {leading ? <span className="list-row__leading">{leading}</span> : null}
      <span className="list-row__text">
        <span className="list-row__title">{title}</span>
        {secondary ? <span className="list-row__secondary">{secondary}</span> : null}
      </span>
      {trailing ? <span className="list-row__trailing">{trailing}</span> : null}
    </>
  )
  return (
    <li {...rest} className={cx('list-row', className)} data-lines={lines}>
      {href ? (
        <a className="list-row__inner list-row__inner--action" href={href} onClick={onClick}>
          {body}
        </a>
      ) : onClick ? (
        <button type="button" className="list-row__inner list-row__inner--action" onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className="list-row__inner">{body}</div>
      )}
    </li>
  )
}
