// "Enter a transfer link": the receiving side of a transfer (PROTOCOL.md section 11). The link comes
// pasted into the field, or opened as #/t/... (the payload was taken out of the address before this
// screen rendered; lib/transfer-inbox.ts). What arrives is checked like a backup file, shown as a
// summary, and written only after the person confirms; existing data is merged, never replaced.

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { ArrowRight, Download } from 'lucide-react'
import { Button, TextField } from '../../../ui/index.ts'
import { deviceHasData, fetchTransfer, receiveTransfer, type IncomingTransfer } from '../../../core/index.ts'
import { useCore } from '../../core/context.ts'
import { useNotify } from '../../core/notify.ts'
import { writeSetupHint } from '../../core/setupHint.ts'
import { useSettings } from '../../core/data.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { cameIn } from '../../lib/format.ts'
import { clearTransferPayload, heldTransferPayload, transferPayloadInText } from '../../lib/transfer-inbox.ts'
import { transferErrorText } from './move-text.ts'
import './move.css'

type State = { kind: 'enter' } | { kind: 'fetching' } | { kind: 'ready'; t: IncomingTransfer; hasData: boolean } | { kind: 'saving'; t: IncomingTransfer; hasData: boolean }

export default function ReceiveScreen() {
  const core = useCore()
  const notify = useNotify()
  const settings = useSettings()
  const [, navigate] = useLocation()
  const [state, setState] = useState<State>({ kind: 'enter' })
  const [text, setText] = useState('')
  const [error, setError] = useState<string | undefined>()
  const started = useRef(false)
  const inSetup = settings?.onboarding?.status === 'active'

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
    if (held) void open(held)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = () => {
    const input = text.trim()
    if (!input) {
      setError('Paste the transfer link from the other device.')
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
      notify(`${cameIn(r.items, r.sharedLists + r.guestLists)} came in. Carry on from one device: Hippo does not keep the two in step.`)
      navigate('/', { replace: true })
    } catch (e) {
      setError(transferErrorText(e))
      setState({ kind: 'enter' })
    }
  }

  const back = inSetup ? '#/existing' : '#/settings'
  return (
    <AppScreen title="Receive from another device" back={back} backLabel="Back" busy={state.kind === 'fetching'}>
      {/* Announced; on screen the summary below says it once. */}
      <p className="move-status sr-only" role="status" aria-live="polite">
        {state.kind === 'fetching' ? 'Getting your wishes from the other device…' : state.kind === 'ready' ? `${cameIn(state.t.summary.items, state.t.summary.lists)} are ready to come in.` : ''}
      </p>
      {state.kind === 'fetching' ? (
        <p className="app-note" aria-hidden="true">
          Getting your wishes from the other device{'\u2026'}
        </p>
      ) : null}
      {state.kind === 'ready' || state.kind === 'saving' ? (
        <section className="app-stack motion-enter" aria-labelledby="receive-ready">
          <h2 id="receive-ready" className="app-section-title">
            Ready to bring in
          </h2>
          <p className="app-note move-summary" data-testid="transfer-summary">{`${cameIn(state.t.summary.items, state.t.summary.lists)}.`}</p>
          {state.hasData ? (
            <p className="app-note">This device already has wishes or lists. They stay, and what is new is added. Lists already here are kept as they are.</p>
          ) : null}
          <p className="app-note">Both devices then hold the same lists. Hippo does not keep them in step afterwards, so carry on from one of them.</p>
          <div className="app-row app-row--fill">
            <Button variant="primary" fullWidth icon={<Download />} loading={state.kind === 'saving'} onClick={() => void bringIn()}>
              {state.hasData ? 'Add them here' : 'Bring them in'}
            </Button>
            <Button variant="secondary" fullWidth disabled={state.kind === 'saving'} onClick={() => setState({ kind: 'enter' })}>
              Cancel
            </Button>
          </div>
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
          <p className="app-note">On the other device, open Settings and choose Move Hippo to another device. Then paste its link here.</p>
          <TextField
            label="Transfer link"
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
