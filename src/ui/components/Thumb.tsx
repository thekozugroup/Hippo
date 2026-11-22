import { useState } from 'react'
import { cx } from '../cx.ts'
import './Thumb.css'

export interface ThumbProps {
  /** Image URL; when missing or broken, a tinted tile with the first letter is shown. */
  src?: string | undefined
  /** Name used for the fallback letter. */
  name: string
  /** Alt text; leave empty when the row already names the item (decorative). */
  alt?: string
  /** 28, 40, 56 or 72px. */
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /** Rounded square (default) or circle. */
  shape?: 'tile' | 'round'
  className?: string
}

/** Rounded image with a graceful letter fallback. */
export function Thumb({ src, name, alt = '', size = 'md', shape = 'tile', className }: ThumbProps) {
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined)
  const showImage = Boolean(src) && failedSrc !== src
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? '?'
  const cls = cx('thumb', `thumb--${size}`, shape === 'round' && 'thumb--round', className)
  if (showImage) {
    return (
      <img
        className={cls}
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        onError={() => setFailedSrc(src)}
      />
    )
  }
  return (
    <span className={cx(cls, 'thumb--fallback')} {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}>
      {letter}
    </span>
  )
}
