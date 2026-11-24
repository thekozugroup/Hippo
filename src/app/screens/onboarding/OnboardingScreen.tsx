// First-run setup for a new owner, one question per screen (#/welcome/<step>).
//
// Why it is built this way:
// - Value first: step 1 says what Hippo does before anything is asked.
// - One decision per screen, each skippable; the flow can be closed at any
//   point and keeps what was entered (answers are saved as they change).
// - Visible progress that starts partly done (the first dot is lit on step 1).
// - Real defaults: the name from Settings, Christmas preselected in season
//   with Christmas Day as the date, the list named from the answer.
// - The person's answers come back to them: their name in the next question,
//   their occasion in the wish question, their wish in the last step.
// - Every step is a history entry, so browser Back, the Back button and
//   Escape all go back a step with the answers kept; leaving the flow goes
//   back to where it started, so Back from Home does not reopen it.
// - It never shows again once finished or closed; Settings can replay it.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bookmark, X } from 'lucide-react'
import { useLocation } from 'wouter'
import { Chip, HeroBackground, IconButton, StepScreen, TextField, TwoTone } from '../../../ui/index.ts'
import {
  LIMITS,
  setOnboarding,
  setOwnerName,
} from '../../../core/index.ts'
import { useCore } from '../../core/context.ts'
import { useSettings, useSharedLists } from '../../core/data.ts'
import { useNotify } from '../../core/notify.ts'
import {
  fromStored,
  isWelcomeStep,
  listNameFor,
  newFlow,
  occasionPhrase,
  OCCASIONS,
  reduceFlow,
  resolveStep,
  stepCount,
  stepNumber,
  suggestedDate,
  toStored,
  welcomeOrder,
  type Answers,
  type Flow,
  type OccasionId,
  type WelcomeStep,
} from '../../core/onboarding.ts'
import { markLogoIntroPlayed, shouldPlayLogoIntro } from '../../core/logoIntro.ts'
import { endBoot } from '../../core/boot.ts'
import { writeSetupHint } from '../../core/setupHint.ts'
import { requestPersistentStorage } from '../../core/storage.ts'
import { historyIndex, returnTo } from '../../layout/motionLocation.ts'
import { appBaseUrl, bookmarkletCode } from '../../lib/capture-tools.ts'
import { possessive } from '../../lib/format.ts'
import { resyncLists } from '../../lib/sync.ts'
import { installHeading, installPlacement, ownStorageReason, whyInstall } from '../../pwa/guide.ts'
import { InstallGuide } from '../../pwa/InstallGuide.tsx'
import { useCopyLink, useInstallAction, useInstallGuide } from '../../pwa/useInstall.ts'
import { isStandalone, wasInstalledHere } from '../../pwa/install.ts'
import { isNativeApp } from '../../native/platform.ts'
import { HOME_ROUTE } from '../../lib/app-route.ts'
import { offersOpenInApp, openInAppLink, useInstalledHere } from '../../pwa/open-in-app.ts'
import { captureMethodFor, hostOf, parseWish, wishError } from './flow.ts'
import { ensureSetupList, ensureSetupWish, persistFlow } from './store.ts'
import './OnboardingScreen.css'

const OCCASION_LABEL: Record<OccasionId, string> = {
  christmas: 'Christmas',
  birthday: 'Birthday',
  wedding: 'Wedding',
  baby: 'New baby',
  justbecause: 'Just because',
  other: 'Something else',
}

/** Generic starting points, never products. Tapping one fills the field. */
const WISH_IDEAS = ['A good book', 'Concert tickets', 'Something for the kitchen'] as const

/** History index of the entry this flow started from, in this tab. */
let flowBase: number | null = null

type Errors = Partial<Record<'name' | 'occasion' | 'occasionText' | 'date' | 'wish' | 'form', string>>

function focusError(): void {
  window.requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('.step-screen [aria-invalid="true"]')
    // A radio group is not focusable itself: focus its chosen or first option.
    const target = el?.getAttribute('role') === 'radiogroup' ? (el.querySelector<HTMLElement>('input:checked') ?? el.querySelector<HTMLElement>('input')) : el
    target?.focus()
  })
}

/** `#/welcome/<step>`: loads the stored progress, then runs the flow. */
export default function OnboardingScreen({ step }: { step: string }) {
  const core = useCore()
  const settings = useSettings()
  const [, navigate] = useLocation()
  const [initial, setInitial] = useState<Flow | null>(null)
  const stored = settings?.onboarding
  if (!initial && stored?.status === 'active') setInitial(fromStored(stored))

  useEffect(() => {
    if (!settings) return
    if (!isWelcomeStep(step)) {
      // An address that is not a step: go to the step in progress (or the first one).
      navigate(`/welcome/${resolveStep(initial?.step ?? (stored?.status === 'active' ? (fromStored(stored)?.step ?? 'start') : 'start'))}`, { replace: true })
      return
    }
    if (resolveStep(step) !== step) {
      // A step this device skips (installing, once Hippo runs installed): the next one instead.
      navigate(`/welcome/${resolveStep(step)}`, { replace: true })
      return
    }
    if (initial) return
    if (!stored) {
      // First visit: start a flow (Home sends new owners here; nothing is written before that).
      void setOnboarding(core.db, toStored({ ...newFlow(settings.ownerName ? { ownerName: settings.ownerName } : {}), step }, core.now()))
      return
    }
    if (stored.status !== 'active') {
      // Finished or closed before: never shown again unless replayed from Settings.
      writeSetupHint(true, core.db.name)
      navigate('/', { replace: true })
    }
  }, [initial, settings, stored, step, core, navigate])

  if (!initial || !isWelcomeStep(step) || resolveStep(step) !== step) {
    return (
      <div className="step-screen step-screen--blank" data-theme="dark" aria-busy="true" aria-label="Loading">
        <HeroBackground variant="night" />
      </div>
    )
  }
  return <SetupFlow initial={initial} step={step} />
}

function SetupFlow({ initial, step }: { initial: Flow; step: WelcomeStep }) {
  const core = useCore()
  const notify = useNotify()
  const [, navigate] = useLocation()
  const lists = useSharedLists()
  const [flow, setFlow] = useState(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const latest = useRef(flow)
  latest.current = flow
  const busyRef = useRef(false)

  useEffect(() => {
    flowBase = historyIndex()
    endBoot()
  }, [])

  const persist = (f: Flow) => {
    persistFlow(core.db, f, core.now()).catch(() => undefined)
  }

  // The address says which step shows (browser Back and Forward included); remember it for resuming.
  useEffect(() => {
    if (latest.current.step === step) return
    const f = { ...latest.current, step }
    setFlow(f)
    persist(f)
    setErrors({})
    // persist is stable in effect; only the step matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // Typing is saved shortly after it stops, so closing the app mid-step keeps it.
  useEffect(() => {
    const id = window.setTimeout(() => persist(latest.current), 400)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.answers])

  const answer = (patch: Partial<Answers>) => {
    setFlow((f) => reduceFlow(f, { type: 'answer', patch }))
    setErrors({})
  }

  const goTo = (next: WelcomeStep) => {
    const f = { ...latest.current, step: next }
    setFlow(f)
    persist(f)
    navigate(`/welcome/${next}`)
  }

  const goNext = () => {
    const steps = welcomeOrder()
    const next = steps[steps.indexOf(step) + 1]
    if (next) goTo(next)
  }

  /** Skip clears this step's answer, so nothing typed and not saved is used later. */
  const skip = (cleared: Partial<Answers>) => {
    if (busyRef.current) return
    const f = reduceFlow(latest.current, { type: 'answer', patch: cleared })
    latest.current = f
    setFlow(f)
    setErrors({})
    goNext()
  }

  const goBack = () => {
    const steps = welcomeOrder()
    const prev = steps[steps.indexOf(step) - 1]
    if (!prev || busyRef.current) return
    if (flowBase !== null && historyIndex() > flowBase) window.history.back()
    else navigate(`/welcome/${prev}`, { replace: true })
  }

  /** Runs one step's save, ignoring repeat presses while it works. */
  const run = async (work: () => Promise<boolean>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      if (await work()) goNext()
    } catch {
      setErrors({ form: 'Could not save that. Please try again.' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const leave = async (status: 'completed' | 'dismissed', target = '/') => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const f = { ...latest.current, status }
    setFlow(f)
    try {
      await persistFlow(core.db, f, core.now())
    } catch {
      // The flow still closes; it may show once more next time.
    }
    writeSetupHint(true, core.db.name)
    busyRef.current = false
    setBusy(false)
    if (status === 'completed') {
      const name = f.answers.name.trim()
      notify(name ? `All set, ${name}.` : 'All set.')
    }
    returnTo(flowBase ?? historyIndex(), target)
  }

  // ---- Saving each answer ----

  const saveName = async (): Promise<boolean> => {
    const name = flow.answers.name.replace(/\s+/g, ' ').trim()
    if ([...name].length > LIMITS.ownerName) {
      setErrors({ name: `Use up to ${LIMITS.ownerName} characters.` })
      focusError()
      return false
    }
    await setOwnerName(core.db, name || undefined)
    // A replay can rename someone whose lists are already shared: update what givers see.
    const shared = (lists ?? []).filter((l) => l.status === 'published').map((l) => l.id)
    resyncLists(core, shared, notify)
    return true
  }

  const occasionErrors = (a: Answers): Errors => {
    if (!a.occasion) return { occasion: 'Choose an occasion, or skip this step.' }
    if (a.occasion === 'other' && !a.occasionText.trim()) return { occasionText: 'Say what the occasion is, or pick one above.' }
    if (a.occasion === 'other' && [...a.occasionText.trim()].length > LIMITS.name) return { occasionText: `Use up to ${LIMITS.name} characters.` }
    return {}
  }

  const saveOccasion = async (): Promise<boolean> => {
    const a = flow.answers
    const errs = occasionErrors(a)
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      focusError()
      return false
    }
    const name = listNameFor(a)
    const listId = await ensureSetupList(core, latest.current, { name, eventDate: a.date })
    setFlow((f) => reduceFlow(f, { type: 'created', listId }))
    latest.current = reduceFlow(latest.current, { type: 'created', listId })
    return true
  }

  const saveWish = async (): Promise<boolean> => {
    const err = wishError(flow.answers.wish)
    const draft = parseWish(flow.answers.wish)
    if (err || !draft) {
      setErrors({ wish: err ?? 'Type a wish or paste a link, or skip this step.' })
      focusError()
      return false
    }
    const { itemId, created } = await ensureSetupWish(core, latest.current, draft)
    setFlow((f) => reduceFlow(f, { type: 'created', itemId }))
    latest.current = reduceFlow(latest.current, { type: 'created', itemId })
    if (created) void requestPersistentStorage()
    return true
  }

  /** Closing keeps what was typed on this step when it is a valid answer. */
  const close = () => {
    if (busyRef.current) return
    void (async () => {
      try {
        if (step === 'name' && flow.answers.name.trim() && [...flow.answers.name.trim()].length <= LIMITS.ownerName) await saveName()
        if (step === 'occasion' && Object.keys(occasionErrors(flow.answers)).length === 0) await saveOccasion()
        if (step === 'wish' && !wishError(flow.answers.wish)) await saveWish()
      } catch {
        // Closing never fails because a save did; the answers stay in the saved progress.
      }
      await leave('dismissed')
    })()
  }

  const closeButton = <IconButton variant="frost" aria-label="Close setup" icon={<X />} onClick={close} />
  const common = {
    step: stepNumber(step),
    total: stepCount(),
    busy,
    onBack: step === 'start' ? undefined : goBack,
    topEnd: step === 'start' ? undefined : closeButton,
    // Once per device, on the first step only (not on Back, resume or replay).
    logoIntro: step === 'start' && shouldPlayLogoIntro(),
    onLogoIntro: markLogoIntroPlayed,
  }
  const formError = errors.form ? (
    <p className="setup-error" role="alert">
      {errors.form}
    </p>
  ) : null
  const name = flow.answers.name.trim()

  switch (step) {
    case 'start':
      return (
        <StepScreen
          {...common}
          title={<TwoTone tone="on-hero" muted="Make a wishlist, share one link," bright="and friends pick gifts without spoiling the surprise." />}
          description={<p>No account needed. Setting up takes about a minute.</p>}
          continueLabel="Get started"
          continueStyle="slide"
          onContinue={goNext}
          secondaryAction={[
            { label: 'I already use Hippo', onClick: () => navigate('/existing') },
            { label: 'Skip setup', onClick: () => void leave('dismissed') },
          ]}
        />
      )

    case 'name':
      return (
        <StepScreen
          {...common}
          title={<TwoTone tone="on-hero" muted="What should we" bright="call you?" />}
          description={<p>Your first name or a nickname is enough.</p>}
          continueLabel="Continue"
          onContinue={() => void run(saveName)}
          secondaryAction={{ label: 'Skip', onClick: () => skip({ name: '' }) }}
        >
          <TextField
            label="Your name"
            value={flow.answers.name}
            autoComplete="given-name"
            autoCapitalize="words"
            enterKeyHint="next"
            maxLength={LIMITS.ownerName * 2}
            onChange={(e) => answer({ name: e.target.value })}
            hint={name ? `Friends you share a list with see “${possessive(name)} list”.` : 'Friends you share a list with see it at the top of the list.'}
            {...(errors.name ? { error: errors.name } : {})}
          />
          {formError}
        </StepScreen>
      )

    case 'occasion':
      return (
        <StepScreen
          {...common}
          title={<TwoTone tone="on-hero" muted={name ? `${name}, what is` : 'What is'} bright="the occasion?" />}
          description={<p>Hippo starts a list for it. Nobody sees it until you share it.</p>}
          continueLabel="Continue"
          onContinue={() => void run(saveOccasion)}
          secondaryAction={{ label: 'Skip', onClick: () => skip({ occasion: '', occasionText: '', date: '' }) }}
        >
          <OccasionChoices
            value={flow.answers.occasion}
            error={errors.occasion}
            onChange={(occasion) => {
              const a = flow.answers
              // Keep a date the person chose; replace a suggestion with the new occasion's.
              const wasSuggested = !a.date || (a.occasion !== '' && a.date === suggestedDate(a.occasion, new Date()))
              answer({ occasion, ...(wasSuggested ? { date: suggestedDate(occasion, new Date()) } : {}) })
            }}
          />
          {flow.answers.occasion === 'other' ? (
            <TextField
              label="What is the occasion?"
              value={flow.answers.occasionText}
              maxLength={LIMITS.name * 2}
              onChange={(e) => answer({ occasionText: e.target.value })}
              hint="This becomes the list's name."
              {...(errors.occasionText ? { error: errors.occasionText } : {})}
            />
          ) : null}
          <TextField
            label="Date (optional)"
            type="date"
            value={flow.answers.date}
            onChange={(e) => answer({ date: e.target.value })}
            hint={
              flow.answers.occasion === 'christmas'
                ? 'Christmas Day is filled in. Change it or clear it.'
                : 'Add it if you know it. Friends see it on the list.'
            }
          />
          {formError}
        </StepScreen>
      )

    case 'wish': {
      const phrase = occasionPhrase(flow.answers)
      const draft = parseWish(flow.answers.wish)
      const host = draft?.url ? hostOf(draft.url) : ''
      return (
        <StepScreen
          {...common}
          title={<TwoTone tone="on-hero" muted="What is one thing" bright={`you would love${phrase ? ` ${phrase}` : ''}?`} />}
          description={<p>Type it, or paste a link from any shop. Price and notes can come later.</p>}
          continueLabel="Save wish"
          onContinue={() => void run(saveWish)}
          secondaryAction={{ label: 'Skip', onClick: () => skip({ wish: '' }) }}
        >
          <TextField
            label="Your wish, or a link to it"
            value={flow.answers.wish}
            enterKeyHint="done"
            maxLength={LIMITS.url + LIMITS.title}
            onChange={(e) => answer({ wish: e.target.value })}
            hint={host && draft ? `Saves the link from ${host} as “${draft.title}”.` : 'A shop link is saved with the wish, so friends can find it.'}
            {...(errors.wish ? { error: errors.wish } : {})}
          />
          {!flow.answers.wish.trim() ? (
            <div className="setup-ideas" role="group" aria-labelledby="setup-ideas-label">
              <p id="setup-ideas-label" className="setup-ideas__label">
                Need an idea?
              </p>
              <div className="setup-ideas__chips">
                {WISH_IDEAS.map((idea) => (
                  <Chip key={idea} tone="frost" onClick={() => answer({ wish: idea })}>
                    {idea}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
          {formError}
        </StepScreen>
      )
    }

    case 'install':
      return <InstallStep common={common} onNext={goNext} />

    case 'capture':
      return <CaptureStep common={common} flow={flow} onFinish={() => void leave('completed')} onSettings={() => void leave('completed', '/settings')} />
  }
}

function OccasionChoices({ value, error, onChange }: { value: OccasionId | ''; error: string | undefined; onChange: (v: OccasionId) => void }) {
  const errorId = 'setup-occasion-error'
  return (
    <div className="setup-choices">
      <div role="radiogroup" aria-label="Occasion" aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className="setup-choices__grid">
        {OCCASIONS.map((o) => (
          <label key={o} className="setup-choice">
            <input type="radio" name="occasion" className="setup-choice__input" value={o} checked={value === o} onChange={() => onChange(o)} />
            <span className="setup-choice__label">{OCCASION_LABEL[o]}</span>
          </label>
        ))}
      </div>
      {error ? (
        <p id={errorId} className="setup-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}

interface CommonProps {
  step: number
  total: number
  busy: boolean
  onBack: (() => void) | undefined
  topEnd: ReactNode
}

/**
 * Putting Hippo on the home screen, with this device's own steps. Where the installed app keeps
 * its own storage this is the second step, and its main button only confirms it was added (setup
 * then starts in the installed app); "Carry on in the browser" continues here. Elsewhere it sits
 * before "add wishes from anywhere": the main button installs where the browser offers it.
 */
function InstallStep({ common, onNext }: { common: CommonProps; onNext: () => void }) {
  const { guide, installedHere } = useInstallGuide()
  const { install, busy } = useInstallAction(guide)
  const copyLink = useCopyLink()
  const [added, setAdded] = useState(false)
  const first = installPlacement(guide) === 'first'
  const heading = installHeading(guide)
  const reason = first ? ownStorageReason(guide) : undefined
  // On Android, Chrome can say whether Hippo is already installed here (open-in-app.ts).
  const here = useInstalledHere(offersOpenInApp(guide))
  const installed = installedHere || guide.kind === 'installed'
  const webAppHere = !installed && here?.webApp === true && here.androidApp !== true

  let main: { label: string; run: () => void }
  let secondary: { label: string; onClick: () => void } | undefined
  let title = heading
  let why: string = whyInstall(guide)
  if (!installed && here?.androidApp) {
    // The Android app is here: open it instead of installing again.
    main = { label: 'Open in the app', run: () => window.location.assign(openInAppLink(HOME_ROUTE)) }
    secondary = { label: 'Carry on here', onClick: onNext }
    title = { muted: 'Hippo is already', bright: 'on this phone' }
    why = 'Open the Hippo app, or carry on here in the browser.'
  } else if (webAppHere) {
    // The web app is here. A browser tab cannot open it, so say where it is.
    main = { label: 'Continue', run: onNext }
    title = { muted: 'Hippo is already', bright: `on your ${guide.place}` }
    why = `Open it from your ${guide.place}. It shares your wishes with this browser.`
  } else if (installed) {
    main = { label: 'Continue', run: onNext }
    secondary = { label: 'Skip', onClick: onNext }
  } else if (guide.kind === 'in-app') {
    main = { label: 'Copy link', run: () => void copyLink(guide) }
    secondary = { label: 'Carry on here', onClick: onNext }
  } else if (guide.kind === 'prompt') {
    main = { label: 'Install Hippo', run: () => void install() }
    secondary = { label: 'Skip', onClick: onNext }
  } else if (first) {
    main = { label: 'I added it', run: () => setAdded(true) }
    secondary = { label: 'Carry on in the browser', onClick: onNext }
  } else {
    main = { label: 'Continue', run: onNext }
    secondary = { label: 'Skip', onClick: onNext }
  }

  return (
    <StepScreen
      {...common}
      busy={common.busy || busy}
      title={<TwoTone tone="on-hero" muted={title.muted} bright={title.bright} />}
      description={
        <>
          <p>{why}</p>
          {reason && !here?.androidApp && !webAppHere ? <p>{reason}</p> : null}
        </>
      }
      continueLabel={main.label}
      onContinue={main.run}
      {...(secondary ? { secondaryAction: secondary } : {})}
    >
      {here?.androidApp || webAppHere ? null : <InstallGuide guide={guide} installed={installedHere} tone="hero" actions={false} />}
      <p className="setup-saved setup-status" role="status">
        {added ? `Now open Hippo from your ${guide.place}. Setup starts there, and you can close this page.` : ''}
      </p>
    </StepScreen>
  )
}

function CaptureStep({ common, flow, onFinish, onSettings }: { common: CommonProps; flow: Flow; onFinish: () => void; onSettings: () => void }) {
  const lists = useSharedLists()
  // The Android app is in the share sheet from the start.
  const method = isNativeApp() ? 'share' : captureMethodFor({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints || 0 })
  const linkRef = useRef<HTMLAnchorElement>(null)
  const bookmarklet = bookmarkletCode(appBaseUrl())
  useEffect(() => {
    // React refuses javascript: URLs in JSX; the CSP blocks running it here anyway.
    linkRef.current?.setAttribute('href', bookmarklet)
  }, [bookmarklet, method])

  const wish = parseWish(flow.answers.wish)
  const list = flow.listId ? lists?.find((l) => l.id === flow.listId) : undefined
  const saved = flow.itemId && wish ? (list ? `“${wish.title}” is on your list ${list.name}.` : `“${wish.title}” is in your wishlist.`) : list ? `Your list ${list.name} is ready.` : null

  let how: ReactNode
  if (method === 'shortcut') {
    how = (
      <>
        <p>On iPhone and iPad, a Shortcut adds the page you are looking at in Safari. It takes about two minutes to set up.</p>
        <div>
          <button type="button" className="setup-action" onClick={onSettings}>
            Show me how
          </button>
        </div>
      </>
    )
  } else if (method === 'share') {
    how =
      isNativeApp() || isStandalone() || wasInstalledHere() ? (
        <p>Use Share in any shop or browser and pick Hippo.</p>
      ) : (
        <p>Once Hippo is on your home screen, use Share in any shop or browser and pick Hippo. Settings shows how to add it.</p>
      )
  } else {
    how = (
      <>
        <p>Drag this button to your bookmarks bar. On any shop page, click it to add that page to Hippo.</p>
        <div>
          <a ref={linkRef} className="setup-action" draggable="true" onClick={(e) => e.preventDefault()} aria-describedby="setup-bm-hint">
            <Bookmark aria-hidden="true" size={20} />
            Add to Hippo
          </a>
        </div>
        <p id="setup-bm-hint" className="setup-small">
          The bookmark only works from your bookmarks bar. Other ways are in Settings.
        </p>
      </>
    )
  }

  return (
    <StepScreen
      {...common}
      title={<TwoTone tone="on-hero" muted="Add wishes" bright="from anywhere" />}
      description={
        <>
          {saved ? <p className="setup-saved motion-enter">{saved}</p> : null}
          {how}
        </>
      }
      continueLabel="Finish"
      onContinue={onFinish}
    />
  )
}
