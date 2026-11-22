import type { ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import './Sheet.css'

export interface SheetProps extends ComponentPropsWithRef<'div'> {
  /** Element to render; use `main` for the page's primary content. */
  as?: 'div' | 'main' | 'section'
}

/** The big rounded surface that rises over the hero. */
export function Sheet({ as: Tag = 'div', className, ...rest }: SheetProps) {
  return <Tag {...rest} className={cx('sheet', className)} />
}
