import { useId, type ComponentPropsWithRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { cx } from '../cx.ts'
import { HeroBackground } from './HeroBackground.tsx'
import { IconButton } from './IconButton.tsx'
import { LogoIntro } from './LogoIntro.tsx'
import { SlideButton } from './SlideButton.tsx'
import { StepProgress } from './StepProgress.tsx'
import './StepScreen.css'

export interface StepAction {
  label: string
  onClick: () => void
}

export interface StepScreenProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'children'> {
  /** The current step, from 1, and the number of steps (shown as dots, read as "Step 2 of 5"). Leave both out on a screen beside the flow (no dots). */
  step?: number
  total?: number
  /** The question or statement; rendered as the page's only h1 (use `TwoTone tone="on-hero"`). */
  title: ReactNode
  /** One or two short sentences under the title. */
  description?: ReactNode
  /** The answer: fields, choices. Pressing Enter in a field continues. */
  children?: ReactNode
  /** Top bar, end side (for example a button that closes the flow). The start side shows the logo. */
  topEnd?: ReactNode
  /** Goes to the previous step; omitted on the first step. Escape does the same, outside open pickers. */
  onBack?: () => void
  backLabel?: string
  /** The wide slide control (`SlideButton`). Runs on a tap, a completed slide, and Enter in a field. */
  continueLabel?: string
  onContinue?: () => void
  /** Busy (a step is saving): the control shows it, ignores presses and cannot be dragged. */
  busy?: boolean
  /** Said on the control while busy. */
  busyLabel?: string
  /** Quiet actions under the pill, such as "Skip" (one, or a short row of them). */
  secondaryAction?: StepAction | readonly StepAction[]
  /**
   * A preview inside another page (the gallery): fits its content, uses a `div` and an `h2` instead of
   * `main` and `h1`, and does not take part in route transitions.
   */
  contained?: boolean
  /** Play the one-time logo intro when this step first appears (see `LogoIntro`); only the value at mount counts. */
  logoIntro?: boolean
  /** Called when the logo intro starts (or is skipped for reduced motion), so the app can remember it was shown. */
  onLogoIntro?: () => void
}

/**
 * One step of a stepped flow on the dark setup field: logo at the top, the question low on the
 * screen where the thumb is, progress dots, then a round Back button and a wide pill to continue.
 */
export function StepScreen({
  step,
  total,
  title,
  description,
  children,
  topEnd,
  onBack,
  backLabel = 'Back',
  continueLabel,
  onContinue,
  busy = false,
  busyLabel,
  secondaryAction,
  contained = false,
  logoIntro = false,
  onLogoIntro,
  className,
  ...rest
}: StepScreenProps) {
  const Main = contained ? 'div' : 'main'
  const Heading = contained ? 'h2' : 'h1'
  const progressId = useId()
  const hasProgress = step !== undefined && total !== undefined && total > 0
  const secondary: readonly StepAction[] = secondaryAction === undefined ? [] : 'label' in secondaryAction ? [secondaryAction] : secondaryAction
  const titleId = useId()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!busy) onContinue?.()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || !onBack || e.defaultPrevented || e.nativeEvent.isComposing) return
    if (e.target instanceof HTMLSelectElement) return
    e.preventDefault()
    onBack()
  }
  return (
    <div data-theme="dark" {...rest} className={cx('step-screen', contained && 'step-screen--contained', className)} onKeyDown={onKeyDown}>
      <HeroBackground variant="night" />
      <div className="step-screen__col">
        <header className="step-screen__top">
          <LogoIntro size={28} play={logoIntro} {...(onLogoIntro ? { onPlay: onLogoIntro } : {})} />
          {topEnd ? <div className="step-screen__top-end">{topEnd}</div> : null}
        </header>
        <Main className="step-screen__main">
          <form className="step-screen__form" onSubmit={submit} noValidate aria-labelledby={titleId}>
            <div className="step-screen__content">
              <Heading id={titleId} className="step-screen__title" tabIndex={-1} aria-describedby={hasProgress ? progressId : undefined}>
                {title}
              </Heading>
              {description ? <div className="step-screen__desc">{description}</div> : null}
              {children ? <div className="step-screen__body">{children}</div> : null}
            </div>
            {hasProgress ? <StepProgress className="step-screen__progress" id={progressId} current={step} total={total} /> : <div className="step-screen__progress" />}
            <div className="step-screen__actions">
              {onBack ? <IconButton type="button" variant="frost" size="lg" className="step-screen__back" aria-label={backLabel} icon={<ArrowLeft />} onClick={onBack} /> : null}
              {continueLabel ? <SlideButton type="submit" className="step-screen__continue" label={continueLabel} busy={busy} {...(busyLabel ? { busyLabel } : {})} /> : null}
            </div>
            {secondary.length > 0 ? (
              <div className="step-screen__secondary">
                {secondary.map((a) => (
                  <button key={a.label} type="button" className="step-screen__link" onClick={a.onClick}>
                    {a.label}
                  </button>
                ))}
              </div>
            ) : null}
          </form>
        </Main>
      </div>
    </div>
  )
}
