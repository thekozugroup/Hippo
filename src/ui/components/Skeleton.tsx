import type { CSSProperties } from 'react'
import { cx } from '../cx.ts'
import './Skeleton.css'

export interface SkeletonProps {
  /** CSS width (default 100%). */
  width?: string | number
  /** CSS height (default 16px). */
  height?: string | number
  /** `pill`, `tile` or `circle` radius. */
  shape?: 'pill' | 'tile' | 'circle'
  className?: string
}

/** Decorative loading placeholder; mark the surrounding region `aria-busy` instead. */
export function Skeleton({ width = '100%', height = 16, shape = 'pill', className }: SkeletonProps) {
  const style: CSSProperties = { width, height }
  return <span aria-hidden="true" className={cx('skeleton', `skeleton--${shape}`, className)} style={style} />
}
