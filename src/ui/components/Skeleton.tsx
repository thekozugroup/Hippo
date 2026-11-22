import type { ComponentPropsWithRef, CSSProperties } from 'react'
import { cx } from '../cx.ts'
import './Skeleton.css'

export interface SkeletonProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** CSS width (default 100%). */
  width?: string | number
  /** CSS height (default 16px). */
  height?: string | number
  /** `pill`, `tile` or `circle` radius. */
  shape?: 'pill' | 'tile' | 'circle'
}

/** Decorative loading placeholder; mark the surrounding region `aria-busy` instead. */
export function Skeleton({ width = '100%', height = 16, shape = 'pill', className, style, ...rest }: SkeletonProps) {
  const size: CSSProperties = { width, height, ...style }
  return <span aria-hidden="true" {...rest} className={cx('skeleton', `skeleton--${shape}`, className)} style={size} />
}
