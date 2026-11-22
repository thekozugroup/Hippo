import type { ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import './ListRow.css'

/** Unstyled-list wrapper for `ListRow`s. `role="list"` keeps list semantics where `list-style: none` removes them (Safari). */
export function List({ className, ...rest }: ComponentPropsWithRef<'ul'>) {
  return <ul role="list" {...rest} className={cx('list', className)} />
}
