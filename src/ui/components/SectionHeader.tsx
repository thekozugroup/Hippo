import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './SectionHeader.css'

export interface SectionHeaderProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  /** Uppercase section label. */
  title: ReactNode
  /** Optional right-hand action, for example "See all". */
  action?: { label: string; href?: string; onClick?: () => void }
  /** Heading level for the title (default 2). */
  level?: 2 | 3 | 4
}

/** Uppercase label on the left, optional quiet action on the right. */
export function SectionHeader({ title, action, level = 2, className, ...rest }: SectionHeaderProps) {
  const Heading = `h${level}` as const
  return (
    <div {...rest} className={cx('section-header', className)}>
      <Heading className="section-header__title">{title}</Heading>
      {action ? (
        action.href ? (
          <a className="section-header__action" href={action.href} onClick={action.onClick}>
            {action.label}
          </a>
        ) : (
          <button type="button" className="section-header__action" onClick={action.onClick}>
            {action.label}
          </button>
        )
      ) : null}
    </div>
  )
}
