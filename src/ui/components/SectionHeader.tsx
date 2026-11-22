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
  /** Use the bright text colour instead of the quiet grey label. */
  strong?: boolean
}

/** Uppercase label on the left, optional quiet action on the right. */
export function SectionHeader({ title, action, level = 2, strong, className, ...rest }: SectionHeaderProps) {
  const Heading = `h${level}` as const
  return (
    <div {...rest} className={cx('section-header', className)}>
      <Heading className={cx('section-header__title', strong && 'is-strong')}>{title}</Heading>
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
