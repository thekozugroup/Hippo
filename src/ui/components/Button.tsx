import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './Button.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'frost' | 'danger'

interface ButtonCommon {
  /** Visual style. */
  variant?: ButtonVariant
  /** `lg` is 56px tall with an uppercase label; `md` is 48px. */
  size?: 'lg' | 'md'
  /** Optional leading icon (decorative). */
  icon?: ReactNode
  /** Shows a spinner, sets `aria-busy` and ignores clicks without losing focus. */
  loading?: boolean
  /** Stretch to the container width. */
  fullWidth?: boolean
  children: ReactNode
}

export interface ButtonProps
  extends ButtonCommon,
    Omit<ComponentPropsWithoutRef<'button'>, 'children'> {}

export interface LinkButtonProps
  extends ButtonCommon,
    Omit<ComponentPropsWithoutRef<'a'>, 'children'> {
  /** Destination. */
  href: string
}

function classes({ variant = 'secondary', size = 'lg', loading, fullWidth }: ButtonCommon, className?: string) {
  return cx(
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    variant === 'frost' && 'frost frost--on-hero',
    loading && 'is-loading',
    fullWidth && 'btn--full',
    className,
  )
}

function Inner({ icon, loading, children }: Pick<ButtonCommon, 'icon' | 'loading' | 'children'>) {
  return (
    <>
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : icon ? <span className="btn__icon" aria-hidden="true">{icon}</span> : null}
      <span className="btn__label">{children}</span>
    </>
  )
}

/** Pill button. Loading keeps focus and ignores clicks; `disabled` uses the native attribute. */
export function Button({
  variant,
  size,
  icon,
  loading,
  fullWidth,
  children,
  className,
  onClick,
  type = 'button',
  ...rest
}: ButtonProps) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      e.preventDefault()
      return
    }
    onClick?.(e)
  }
  return (
    <button
      {...rest}
      type={type}
      className={classes({ variant, size, loading, fullWidth, children }, className)}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
    >
      <Inner icon={icon} loading={loading}>
        {children}
      </Inner>
    </button>
  )
}

/** A link styled as a `Button`. */
export function LinkButton({ variant, size, icon, loading, fullWidth, children, className, ...rest }: LinkButtonProps) {
  return (
    <a {...rest} className={classes({ variant, size, loading, fullWidth, children }, className)}>
      <Inner icon={icon} loading={loading}>
        {children}
      </Inner>
    </a>
  )
}
