// "Add a device": the sending side of a device link (PROTOCOL.md sections 11 and 12.6). It turns
// the account on if needed, then makes a link that works once, for 15 minutes, and carries the
// account (and a snapshot, so the other device is usable before its first sync). It shows the link
// with Copy and Share, counts down, can cancel, and says when the other device is signed in. The
// open link is kept in memory for this app session only; it is never stored.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Check, Copy, Send, Share2, X } from 'lucide-react'
import { Button, LinkButton, TextField } from '../../../ui/index.ts'
import { cancelTransfer, watchTransfer, type Core, type OutgoingState, type OutgoingTransfer } from '../../../core/index.ts'
import { useCore } from '../../core/context.ts'
import { useNotify } from '../../core/notify.ts'
import { makeDeviceLink } from './device-link.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { shareBaseUrl } from '../../lib/site-address.ts'
import { SiteReachNote } from '../../lib/SiteReach.tsx'
import { canShareSheet, shareSheet } from '../../native/index.ts'
import { timeLeftText, transferStartError } from '../move/move-text.ts'
import '../move/move.css'

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

export default function AddDeviceScreen() {
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
      start(core, await makeDeviceLink(core, shareBaseUrl(), setProgress))
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
      notify('Link copied. Open it on your other device.')
    } catch {
      document.querySelector<HTMLInputElement>('#device-link')?.select()
      notify('Select the link and copy it.')
    }
  }

  const share = async () => {
    if (!s) return
    const outcome = await shareSheet({ title: 'Hippo device link', url: s.transfer.url })
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
    <AppScreen area="settings" title="Add a device" back="#/settings" backLabel="Back to Settings">
      <section className="app-stack" aria-labelledby="add-how">
        <h2 id="add-how" className="app-section-title">
          How it works
        </h2>
        <p className="app-note">Make a link here and open it on your other phone or browser within 15 minutes. That device signs in to your Hippo, and from then on both stay in step.</p>
      </section>

      <p className="move-status" role="status" aria-live="polite">
        {s?.phase === 'moved'
          ? 'Your other device is signed in.'
          : s?.phase === 'cancelled'
            ? 'Link cancelled. It no longer works.'
            : s?.phase === 'expired'
              ? 'This link has expired. Make a new one if you still need it.'
              : busy
                ? `Making the link${progress > 0 && progress < 1 ? ` (${Math.round(progress * 100)}%)` : ''}…`
                : ''}
      </p>

      {waiting && s ? (
        <section className="app-stack motion-enter" aria-labelledby="add-link">
          <h2 id="add-link" className="app-section-title">
            Your link
          </h2>
          <TextField
            id="device-link"
            label="Device link"
            readOnly
            value={s.transfer.url}
            onFocus={(e) => e.currentTarget.select()}
            hint="It works once. Anyone who opens it in the next 15 minutes can read and change your wishlist, so send it only to yourself."
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
              Cancel link
            </Button>
          </div>
        </section>
      ) : (
        <div className="app-stack">
          <div>
            <Button variant="primary" icon={<Send />} loading={busy} onClick={() => void make()}>
              {s ? 'Make a new link' : 'Make a link'}
            </Button>
          </div>
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="app-note">No link at hand? Sign in on the other device with your recovery code instead.</p>
          <div>
            <LinkButton href="#/account/code" variant="ghost" size="md">
              Show recovery code
            </LinkButton>
          </div>
        </div>
      )}
    </AppScreen>
  )
}
