import type { ComponentPropsWithoutRef } from 'react'
import { cx } from '../cx.ts'
import './ListRow.css'

/** Unstyled-list wrapper for `ListRow`s. */
export function List({ className, ...rest }: ComponentPropsWithoutRef<'ul'>) {
  return <ul {...rest} className={cx('list', className)} />
}
