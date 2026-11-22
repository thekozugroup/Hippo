import { useState } from 'react'
import type { ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import './Thumb.css'

export interface ThumbProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** Image URL; when missing or broken, the tinted tile with the first letter stays visible. */
  src?: string | undefined
  /** Name used for the fallback letter. */
  name: string
  /** Alt text; leave empty when the row already names the item (decorative). */
  alt?: string
  /** 28, 40, 56 or 72px. */
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /** Rounded square (default) or circle. */
  shape?: 'tile' | 'round'
}

type Load = { src: string | undefined; status: 'loading' | 'loaded' | 'failed' }

/**
 * Rounded image over a letter tile. The tile is always rendered underneath, so a slow, lazy,
 * blocked or broken image never leaves a blank square; the letter hides once the image has loaded.
 */
export function Thumb({ src, name, alt = '', size = 'md', shape = 'tile', className, ...rest }: ThumbProps) {
  const [load, setLoad] = useState<Load>({ src: undefined, status: 'loading' })
  const status = load.src === src ? load.status : 'loading'
  const showImage = Boolean(src) && status !== 'failed'
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? '?'
  const named = Boolean(alt)
  return (
    <span
      {...rest}
      className={cx('thumb', `thumb--${size}`, shape === 'round' && 'thumb--round', 'thumb--fallback', status === 'loaded' && 'is-loaded', className)}
      {...(named && !showImage ? { role: 'img', 'aria-label': alt } : {})}
    >
      <span className="thumb__letter" aria-hidden="true">
        {letter}
      </span>
      {showImage ? (
        <img
          className="thumb__img"
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onLoad={() => setLoad({ src, status: 'loaded' })}
          onError={() => setLoad({ src, status: 'failed' })}
        />
      ) : null}
    </span>
  )
}
