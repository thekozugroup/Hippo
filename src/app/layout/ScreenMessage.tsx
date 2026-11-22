import type { ReactNode } from 'react'

/**
 * The body of a screen whose heading already says what happened (errors, broken links):
 * one or two sentences on what to do, then the actions. No second headline.
 */
export function ScreenMessage({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="screen-message">
      <div className="screen-message__text">{children}</div>
      {actions ? <div className="screen-message__actions">{actions}</div> : null}
    </div>
  )
}
