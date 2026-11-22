import { useId } from 'react'
import { cx } from '../cx.ts'
import './Logo.css'

export interface LogoProps {
  /** Glyph size in px; the wordmark scales with it. */
  size?: number
  /** Show only the glyph. */
  markOnly?: boolean
  /** Accessible name; the glyph is decorative when the wordmark is shown. */
  label?: string
  className?: string
}

/** Hippo glyph (inline SVG, `currentColor`) with an optional wordmark. */
export function Logo({ size = 28, markOnly = false, label = 'Hippo', className }: LogoProps) {
  const id = useId()
  return (
    <span className={cx('logo', className)} style={{ fontSize: size * 0.82 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        {...(markOnly ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      >
        <defs>
          <mask id={`${id}-m`}>
            <rect width="48" height="48" fill="#fff" />
            <circle cx="15.5" cy="14.5" r="2.4" fill="#000" />
            <circle cx="32.5" cy="14.5" r="2.4" fill="#000" />
            <ellipse cx="17.5" cy="31" rx="2.6" ry="3.2" fill="#000" />
            <ellipse cx="30.5" cy="31" rx="2.6" ry="3.2" fill="#000" />
          </mask>
        </defs>
        <g mask={`url(#${id}-m)`} fill="currentColor">
          <circle cx="5.5" cy="19" r="3.6" />
          <circle cx="42.5" cy="19" r="3.6" />
          <circle cx="15.5" cy="14.5" r="6.2" />
          <circle cx="32.5" cy="14.5" r="6.2" />
          <path d="M5 28c0-8 8-14 19-14s19 6 19 14v4c0 7-8 11-19 11S5 39 5 32z" />
        </g>
      </svg>
      {markOnly ? null : <span className="logo__word">Hippo</span>}
    </span>
  )
}
