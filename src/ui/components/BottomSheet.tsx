import { useEffect, useId, useRef } from 'react'
import type { MouseEvent, ReactNode, SyntheticEvent } from 'react'
import { X } from 'lucide-react'
import { cx } from '../cx.ts'
import { IconButton } from './IconButton.tsx'
import './BottomSheet.css'

export interface BottomSheetProps {
  /** Whether the sheet is open. */
  open: boolean
  /** Called when the user dismisses the sheet (Escape, close button, backdrop). */
  onClose: () => void
  /** Title, used as the dialog's accessible name. */
  title: string
  /** Optional description under the title. */
  description?: string
  /** Sheet content. */
  children?: ReactNode
  /** Label for the close button. */
  closeLabel?: string
  className?: string
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Modal dialog that slides up on phones and centres on wide screens. Uses `<dialog>`. */
export function BottomSheet({ open, onClose, title, description, children, closeLabel = 'Close', className }: BottomSheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      // Land on the first control in the body, falling back to the close button.
      const body = dialog.querySelector<HTMLElement>('.bottom-sheet__body')
      const target = body?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog.querySelector<HTMLElement>(FOCUSABLE)
      target?.focus()
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      returnTo.current?.focus()
      returnTo.current = null
    }
  }, [open])

  // Closing the page's last reference to the dialog must not leave it modal.
  useEffect(() => {
    const dialog = ref.current
    return () => {
      if (dialog?.open && typeof dialog.close === 'function') dialog.close()
    }
  }, [])

  const handleCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    // Escape: let React state own the open flag.
    e.preventDefault()
    onClose()
  }

  const handleBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <dialog
      ref={ref}
      className={cx('bottom-sheet', 'frost-backdrop', className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={handleCancel}
      onClick={handleBackdrop}
    >
      <div className="bottom-sheet__panel">
        <span className="bottom-sheet__grab" aria-hidden="true" />
        <header className="bottom-sheet__head">
          <div className="bottom-sheet__heading">
            <h2 className="bottom-sheet__title" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p className="bottom-sheet__desc" id={descId}>
                {description}
              </p>
            ) : null}
          </div>
          <IconButton aria-label={closeLabel} icon={<X strokeWidth={1.75} />} onClick={onClose} />
        </header>
        <div className="bottom-sheet__body">{children}</div>
      </div>
    </dialog>
  )
}
