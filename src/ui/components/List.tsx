import { useRef, type ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import { useListMotion } from '../motion.ts'
import { mergeRefs } from '../refs.ts'
import './ListRow.css'

export interface ListProps extends ComponentPropsWithRef<'ul'> {
  /** Rows glide to a new place when the list is reordered or filtered, and new rows rise in. Default true. */
  animate?: boolean
  /**
   * On medium and expanded windows (src/ui/layout.ts): `stack` (default) keeps one column of rows,
   * `columns` flows the rows into as many columns as fit, `cards` shows each row as a card in a grid
   * (cards in a row share one height). Phones always show one column of rows.
   */
  layout?: 'stack' | 'columns' | 'cards'
}

/** Unstyled-list wrapper for `ListRow`s. `role="list"` keeps list semantics where `list-style: none` removes them (Safari). */
export function List({ className, animate = true, layout = 'stack', ref, ...rest }: ListProps) {
  const own = useRef<HTMLUListElement>(null)
  useListMotion(own, animate)
  return <ul role="list" {...rest} ref={mergeRefs(own, ref)} className={cx('list', layout !== 'stack' && `list--${layout}`, className)} />
}
