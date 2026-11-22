import type { MouseEventHandler, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './ListRow.css'

export interface ListRowProps {
  /** Leading element, usually a `Thumb`. */
  leading?: ReactNode
  /** Primary text. */
  title: ReactNode
  /** Secondary line under the title. */
  secondary?: ReactNode
  /** Trailing value or control. Do not put controls here when the row is also a link or button. */
  trailing?: ReactNode
  /** Makes the whole row a link. */
  href?: string
  /** Makes the whole row a button (or fires on a link). */
  onClick?: MouseEventHandler<HTMLElement>
  className?: string
}

/** One list row (render inside a `List`): thumb, two text lines, trailing value. */
export function ListRow({ leading, title, secondary, trailing, href, onClick, className }: ListRowProps) {
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
    <li className={cx('list-row', className)}>
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
