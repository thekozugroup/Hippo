import { useEffect, useId, useRef } from 'react'
import type { ComponentPropsWithRef, MouseEvent, PointerEvent, ReactNode, SyntheticEvent } from 'react'
import { X } from 'lucide-react'
import { cx } from '../cx.ts'
import { mergeRefs } from '../refs.ts'
import { IconButton } from './IconButton.tsx'
import './BottomSheet.css'

export interface BottomSheetProps extends Omit<ComponentPropsWithRef<'dialog'>, 'title' | 'children' | 'open' | 'onClose' | 'onCancel'> {
  /** Whether the sheet is open. */
  open: boolean
  /** Called when the user dismisses the sheet: Escape, close button, backdrop, or the browser closing the dialog. */
  onClose: () => void
  /** Title, used as the dialog's accessible name. */
  title: string
  /** Optional description under the title. */
  description?: string
  /** Sheet content. */
  children?: ReactNode
  /** Label for the close button. */
  closeLabel?: string
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal dialog that slides up on phones and centres on wide screens. Uses `<dialog>`, so focus is
 * contained and the page behind is inert; background scroll is locked in CSS. React state stays
 * the source of truth: if the browser closes the dialog on its own, `onClose` is called.
 */
export function BottomSheet({ open, onClose, title, description, children, closeLabel = 'Close', className, ref, ...rest }: BottomSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const openRef = useRef(open)
  const pressedBackdrop = useRef(false)
  const closedByProp = useRef(false)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    openRef.current = open
    const dialog = dialogRef.current
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
      closedByProp.current = true
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      returnTo.current?.focus()
      returnTo.current = null
    }
  }, [open])

  // Unmounting while open must not leave the page modal.
  useEffect(() => {
    const dialog = dialogRef.current
    return () => {
      if (dialog?.open && typeof dialog.close === 'function') dialog.close()
    }
  }, [])

  // The browser can close the dialog without React (a second Escape, form method=dialog, the
  // back gesture). Tell the owner so `open` does not stay true over a closed dialog.
  const handleNativeClose = () => {
    if (closedByProp.current) {
      // The close event for a close this component caused itself.
      closedByProp.current = false
      return
    }
    if (openRef.current) {
      returnTo.current?.focus()
      returnTo.current = null
      onClose()
    }
  }

  const handleCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    // Escape: let React state own the open flag.
    e.preventDefault()
    onClose()
  }

  // Close on a backdrop click only when the press also started on the backdrop, so selecting text
  // or dragging inside the sheet and releasing outside does not dismiss it.
  const handlePointerDown = (e: PointerEvent<HTMLDialogElement>) => {
    pressedBackdrop.current = e.target === e.currentTarget
  }
  const handleBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    const started = pressedBackdrop.current
    pressedBackdrop.current = false
    if (started && e.target === e.currentTarget) onClose()
  }

  return (
    <dialog
      {...rest}
      ref={mergeRefs(dialogRef, ref)}
      className={cx('bottom-sheet', 'frost-backdrop', className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={handleCancel}
      onClose={handleNativeClose}
      onPointerDown={handlePointerDown}
      onClick={handleBackdrop}
    >
      <div className="bottom-sheet__panel">
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
