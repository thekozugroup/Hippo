// "Move Hippo to another device": the source side of a transfer (PROTOCOL.md section 11). It makes
// a link that works for 15 minutes, shows it with Copy and Share, counts down, can cancel, and says
// "Moved" once the other device has it. The open transfer is kept in memory for this app session,
// so leaving this screen and coming back shows it again; it is never stored.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Check, Copy, Send, Share2, X } from 'lucide-react'
import { Button, TextField } from '../../../ui/index.ts'
import { cancelTransfer, createTransfer, watchTransfer, type OutgoingState, type OutgoingTransfer } from '../../../core/index.ts'
import { useCore } from '../../core/context.ts'
import { useNotify } from '../../core/notify.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { shareBaseUrl } from '../../lib/site-address.ts'
import { SiteReachNote } from '../../lib/SiteReach.tsx'
import { canShareSheet, shareSheet } from '../../native/index.ts'
import { cameIn } from '../../lib/format.ts'
import type { Core } from '../../../core/index.ts'
import { timeLeftText, transferStartError } from './move-text.ts'
import './move.css'

type Phase = OutgoingState | 'expired'

interface Session {
  transfer: OutgoingTransfer
  phase: Phase
  stop: () => void
}

let session: Session | null = null
const listeners = new Set<() => void>()
const emit = () => {
  for (const fn of listeners) fn()
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const current = () => session

function start(core: Core, transfer: OutgoingTransfer): void {
  session?.stop()
  const s: Session = { transfer, phase: 'waiting', stop: () => undefined }
  s.stop = watchTransfer(core, transfer, (phase) => {
    if (session !== s) return
    session = { ...s, phase }
    emit()
  })
  session = s
  emit()
}

function setPhase(phase: Phase): void {
  if (!session) return
  if (phase !== 'waiting') session.stop()
  session = { ...session, phase }
  emit()
}

export default function MoveScreen() {
  const core = useCore()
  const notify = useNotify()
  const s = useSyncExternalStore(subscribe, current, current)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | undefined>()
  const [now, setNow] = useState(() => core.now())
  const [copied, setCopied] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (s?.phase !== 'waiting') return undefined
    const tick = () => {
      const t = core.now()
      setNow(t)
      if (t >= s.transfer.expiresAtMs) setPhase('expired')
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [s, core])

  const make = async () => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    setProgress(0)
    try {
      const t = await createTransfer(core, { siteBase: shareBaseUrl(), onProgress: setProgress })
      start(core, t)
    } catch (e) {
      setError(transferStartError(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!s) return
    try {
      await navigator.clipboard.writeText(s.transfer.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
      notify('Link copied. Open it on the other device.')
    } catch {
      document.querySelector<HTMLInputElement>('#transfer-link')?.select()
      notify('Select the link and copy it.')
    }
  }

  const share = async () => {
    if (!s) return
    const outcome = await shareSheet({ title: 'Hippo transfer link', url: s.transfer.url })
    if (outcome === 'failed') notify('Sharing did not work here. Copy the link instead.')
  }

  const cancel = async () => {
    if (!s || cancelling) return
    setCancelling(true)
    try {
      await cancelTransfer(core, s.transfer)
    } catch {
      // It expires on its own in a few minutes.
    }
    setPhase('cancelled')
    setCancelling(false)
  }

  const waiting = s?.phase === 'waiting'
  return (
    <AppScreen area="settings" title="Move to another device" back="#/settings" backLabel="Back to Settings">
      <section className="app-stack" aria-labelledby="move-how">
        <h2 id="move-how" className="app-section-title">
          How it works
        </h2>
        <p className="app-note">Make a link here and open it on your other phone or browser within 15 minutes. Your wishes and lists come across, encrypted on the way.</p>
        <p className="app-note">Both devices then hold the same lists. Hippo does not keep them in step afterwards, so carry on from one of them.</p>
      </section>

      <p className="move-status" role="status" aria-live="polite">
        {s?.phase === 'moved'
          ? `Moved. ${cameIn(s.transfer.summary.items, s.transfer.summary.lists)} are on the other device now.`
          : s?.phase === 'cancelled'
            ? 'Transfer cancelled. The link no longer works.'
            : s?.phase === 'expired'
              ? 'This link has expired. Make a new one if you still need it.'
              : busy
                ? `Preparing the link${progress > 0 && progress < 1 ? ` (${Math.round(progress * 100)}%)` : ''}…`
                : ''}
      </p>

      {waiting && s ? (
        <section className="app-stack motion-enter" aria-labelledby="move-link">
          <h2 id="move-link" className="app-section-title">
            Your transfer link
          </h2>
          <TextField
            id="transfer-link"
            label="Transfer link"
            readOnly
            value={s.transfer.url}
            onFocus={(e) => e.currentTarget.select()}
            hint="Anyone who gets this link in the next 15 minutes can copy your wishlist and lists. Send it only to yourself."
            data-testid="transfer-link"
          />
          <SiteReachNote />
          <p className="app-note" aria-live="off" data-testid="transfer-time">
            {timeLeftText(s.transfer.expiresAtMs - now)}
          </p>
          <div className="app-row app-row--fill">
            <Button variant="primary" size="md" fullWidth icon={copied ? <Check /> : <Copy />} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            {canShareSheet() ? (
              <Button variant="secondary" size="md" fullWidth icon={<Share2 />} onClick={() => void share()}>
                Share link
              </Button>
            ) : null}
          </div>
          <div>
            <Button variant="ghost" size="md" icon={<X />} loading={cancelling} onClick={() => void cancel()}>
              Cancel transfer
            </Button>
          </div>
        </section>
      ) : (
        <div className="app-stack">
          {s?.phase === 'moved' ? <p className="app-note">Carry on from one device: changes you make on one do not appear on the other.</p> : null}
          <div>
            <Button variant="primary" icon={<Send />} loading={busy} onClick={() => void make()}>
              {s ? 'Make a new link' : 'Make a transfer link'}
            </Button>
          </div>
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </AppScreen>
  )
}
