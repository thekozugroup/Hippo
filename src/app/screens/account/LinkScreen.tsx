// "I have a link from my other device": the receiving side of a device link (PROTOCOL.md sections 11
// and 12.6). The link comes pasted, or opened as #/t/... (its secret left the address bar before this
// rendered; lib/transfer-inbox.ts), or shared into the Android app. What arrives is checked like a
// backup file and shown as a summary; nothing is written, and this device is not signed in, until
// the person confirms. A link from an older Hippo (no account inside) still copies once.

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { ArrowRight, LogIn } from 'lucide-react'
import { Button, TextField } from '../../../ui/index.ts'
import { deviceHasData, fetchTransfer, receiveTransfer, type IncomingTransfer } from '../../../core/index.ts'
import { useCore } from '../../core/context.ts'
import { useNotify } from '../../core/notify.ts'
import { writeSetupHint } from '../../core/setupHint.ts'
import { useSettings } from '../../core/data.ts'
import { startAccountSync } from '../../core/account.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { cameIn } from '../../lib/format.ts'
import { clearTransferPayload, heldTransferPayload, transferPayloadInText } from '../../lib/transfer-inbox.ts'
import { transferErrorText } from '../move/move-text.ts'
import { offersOpenInApp } from '../../pwa/open-in-app.ts'
import { OpenInAppLink } from '../../pwa/OpenInAppLink.tsx'
import { installGuideFor, readInstallEnv } from '../../pwa/guide.ts'
import '../move/move.css'

type State = { kind: 'enter' } | { kind: 'fetching' } | { kind: 'ready'; t: IncomingTransfer; hasData: boolean } | { kind: 'saving'; t: IncomingTransfer; hasData: boolean }

export default function LinkScreen() {
  const core = useCore()
  const notify = useNotify()
  const settings = useSettings()
  const [, navigate] = useLocation()
  const [state, setState] = useState<State>({ kind: 'enter' })
  const [text, setText] = useState('')
  const [error, setError] = useState<string | undefined>()
  const started = useRef(false)
  // A device link opened in an Android browser can be handed to the Hippo app instead. The payload
  // is a secret: it stays in memory and in that one link, never in the address or a log.
  const [forApp, setForApp] = useState<string | undefined>()
  const [androidBrowser] = useState(() => offersOpenInApp(installGuideFor(readInstallEnv(false))))
  const inSetup = settings?.onboarding === undefined || settings.onboarding.status === 'active'

  const open = async (payload: string) => {
    setError(undefined)
    setState({ kind: 'fetching' })
    try {
      const t = await fetchTransfer(core, payload)
      setState({ kind: 'ready', t, hasData: await deviceHasData(core) })
    } catch (e) {
      setError(transferErrorText(e))
      setState({ kind: 'enter' })
    } finally {
      clearTransferPayload()
    }
  }

  // A link opened as #/t/... (or handed over by Android): start at once.
  useEffect(() => {
    if (started.current) return
    started.current = true
    const held = heldTransferPayload()
    if (held) {
      if (androidBrowser) setForApp(held)
      void open(held)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = () => {
    const input = text.trim()
    if (!input) {
      setError('Paste the link from your other device.')
      return
    }
    void open(transferPayloadInText(input) ?? input)
  }

  const bringIn = async () => {
    if (state.kind !== 'ready') return
    setState({ kind: 'saving', t: state.t, hasData: state.hasData })
    try {
      const r = await receiveTransfer(core, state.t)
      writeSetupHint(true, core.db.name)
      if (r.signedIn) {
        await startAccountSync(core)
        notify('Signed in. This device now stays in step with your others.')
      } else {
        notify(`${cameIn(r.items, r.sharedLists + r.guestLists)} came in. This was a one-time copy from an older Hippo.`)
      }
      navigate('/', { replace: true })
    } catch (e) {
      setError(transferErrorText(e))
      setState({ kind: 'enter' })
    }
  }

  const signs = (state.kind === 'ready' || state.kind === 'saving') && state.t.account !== undefined
  return (
    <AppScreen {...(inSetup ? {} : { area: 'settings' as const })} title="Sign in with a link" back={inSetup ? '#/existing' : '#/settings'} backLabel="Back" busy={state.kind === 'fetching'}>
      <p className="move-status sr-only" role="status" aria-live="polite">
        {state.kind === 'fetching' ? 'Opening the link from your other device…' : state.kind === 'ready' ? `${cameIn(state.t.summary.items, state.t.summary.lists)} are ready.` : ''}
      </p>
      {state.kind === 'fetching' ? (
        <p className="app-note" aria-hidden="true">
          Opening the link from your other device{'…'}
        </p>
      ) : null}
      {state.kind === 'ready' || state.kind === 'saving' ? (
        <section className="app-stack motion-enter" aria-labelledby="link-ready">
          <h2 id="link-ready" className="app-section-title">
            {signs ? 'Ready to sign in' : 'Ready to bring in'}
          </h2>
          <p className="app-note move-summary" data-testid="transfer-summary">{`${cameIn(state.t.summary.items, state.t.summary.lists)}.`}</p>
          {state.hasData ? <p className="app-note">This device already has wishes or lists. They stay, and are added to the rest.</p> : null}
          <p className="app-note">
            {signs
              ? 'This device then stays in step with your other one. Only continue if you made this link yourself.'
              : 'This link is from an older Hippo: it copies once, and the two devices do not stay in step.'}
          </p>
          <div className="app-row app-row--fill">
            <Button variant="primary" fullWidth icon={<LogIn />} loading={state.kind === 'saving'} onClick={() => void bringIn()}>
              {signs ? 'Sign in here' : 'Bring them in'}
            </Button>
            <Button variant="secondary" fullWidth disabled={state.kind === 'saving'} onClick={() => setState({ kind: 'enter' })}>
              Cancel
            </Button>
          </div>
          {forApp ? <OpenInAppLink route={{ kind: 'transfer', payload: forApp }} /> : null}
        </section>
      ) : (
        <form
          className="app-stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <p className="app-note">On your other device, open Settings and choose Add a device. Then open its link here, or paste it below. It works for 15 minutes.</p>
          <TextField
            label="Link from your other device"
            value={text}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            onChange={(e) => setText(e.target.value)}
            {...(error ? { error } : {})}
          />
          <div>
            <Button type="submit" variant="primary" icon={<ArrowRight />} loading={state.kind === 'fetching'}>
              Open link
            </Button>
          </div>
        </form>
      )}
    </AppScreen>
  )
}
