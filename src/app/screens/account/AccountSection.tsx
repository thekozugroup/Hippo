// Settings, "Your devices": whether this device is signed in to your Hippo and in step, and every
// account action: add a device, show the recovery code, sync on this device, change the code, sign
// out. Wording is plain and honest: no accounts in the usual sense, nothing Hippo can reset.

import { useState, useSyncExternalStore } from 'react'
import { useLocation } from 'wouter'
import { useLiveQuery } from 'dexie-react-hooks'
import { KeyRound, Link2, LogIn, LogOut, RefreshCw, Smartphone } from 'lucide-react'
import { BottomSheet, Button, LinkButton, Switch } from '../../../ui/index.ts'
import { accountSummary, changeRecoveryCode, setAccountSync, signOutOfAccount } from '../../../core/account/service.ts'
import { useCore } from '../../core/context.ts'
import { useNotify } from '../../core/notify.ts'
import { startAccountSync } from '../../core/account.ts'
import { accountEngine, syncAccountNow, type AccountSyncStatus } from '../../core/account-runtime.ts'
import { writeSetupHint } from '../../core/setupHint.ts'
import { statusLine } from './account-text.ts'
import './account.css'

const OFF: AccountSyncStatus = { state: 'off' }
const noop = () => () => undefined

function useEngineStatus(): AccountSyncStatus {
  const engine = accountEngine()
  return useSyncExternalStore(engine?.subscribe ?? noop, engine?.getStatus ?? (() => OFF), () => OFF)
}

export function AccountSection() {
  const core = useCore()
  const notify = useNotify()
  const [, navigate] = useLocation()
  const summary = useLiveQuery(() => accountSummary(core.db), [core])
  const live = useEngineStatus()
  const [sheet, setSheet] = useState<'none' | 'change' | 'signout'>('none')
  const [busy, setBusy] = useState<'none' | 'change' | 'keep' | 'remove' | 'sync'>('none')

  if (!summary) return <section className="app-stack" aria-busy="true" aria-label="Your devices" />

  if (summary.phase === 'none') {
    return (
      <section className="app-stack" aria-labelledby="set-account">
        <h2 id="set-account" className="app-section-title">
          Your devices
        </h2>
        <p className="app-note">Use your wishlist and lists on your other phones and browsers, and keep them in step. They travel through Hippo&apos;s sync servers, encrypted so the servers cannot read them.</p>
        <div className="app-row app-row--fill">
          <LinkButton href="#/move" variant="secondary" size="md" fullWidth icon={<Smartphone />}>
            Add a device
          </LinkButton>
          <LinkButton href="#/account/sign-in" variant="secondary" size="md" fullWidth icon={<LogIn />}>
            Sign in with a code
          </LinkButton>
        </div>
        <div>
          <LinkButton href="#/move/receive" variant="ghost" size="md" icon={<Link2 />}>
            I have a link from another device
          </LinkButton>
        </div>
      </section>
    )
  }

  const line = statusLine(summary, { offline: live.state === 'offline', syncing: live.state === 'syncing' })

  const toggle = async (on: boolean) => {
    setBusy('sync')
    try {
      await setAccountSync(core.db, on)
      if (on) {
        await startAccountSync(core)
        void syncAccountNow()
      }
    } catch {
      notify('Could not change this setting. Please try again.')
    } finally {
      setBusy('none')
    }
  }

  const changeCode = async () => {
    setBusy('change')
    try {
      await changeRecoveryCode(core)
      await startAccountSync(core)
      void syncAccountNow()
      setSheet('none')
      navigate('/account/code')
    } catch {
      notify('A new code could not be made. Please try again.')
    } finally {
      setBusy('none')
    }
  }

  const signOut = async (removeData: boolean) => {
    setBusy(removeData ? 'remove' : 'keep')
    try {
      await signOutOfAccount(core.db, { removeData })
      void syncAccountNow()
      setSheet('none')
      if (removeData) {
        writeSetupHint(false, core.db.name)
        notify('Signed out. Your wishes were removed from this device only.')
        navigate('/', { replace: true })
      } else notify('Signed out. Your wishes stay on this device, and no longer stay in step.')
    } catch {
      notify('Signing out did not work. Please try again.')
    } finally {
      setBusy('none')
    }
  }

  return (
    <section className="app-stack" aria-labelledby="set-account">
      <h2 id="set-account" className="app-section-title">
        Your devices
      </h2>
      <p className={`account-status account-status--${line.tone}`} role="status" data-testid="account-status">
        <span className="account-status__dot" aria-hidden="true" />
        <span>{line.text}</span>
      </p>
      {summary.phase === 'replaced' ? (
        <div>
          <LinkButton href="#/account/sign-in" variant="primary" size="md" icon={<LogIn />}>
            Sign in with the new code
          </LinkButton>
        </div>
      ) : (
        <>
          {summary.recoverySavedAt === undefined ? (
            <p className="app-note app-note--warning">Save your recovery code. Without it, no new device can sign in if you lose this one.</p>
          ) : null}
          <div className="app-row app-row--fill">
            <LinkButton href="#/move" variant="secondary" size="md" fullWidth icon={<Smartphone />}>
              Add a device
            </LinkButton>
            <LinkButton href="#/account/code" variant="secondary" size="md" fullWidth icon={<KeyRound />}>
              Show recovery code
            </LinkButton>
          </div>
          <Switch
            label="Sync on this device"
            description="When off, changes here stay on this device, and changes from your other devices do not arrive."
            checked={summary.phase === 'on'}
            disabled={busy === 'sync'}
            onChange={(e) => void toggle(e.target.checked)}
          />
        </>
      )}
      <ul className="settings-facts">
        <li>Hippo has no accounts in the usual sense and cannot reset anything. Anyone with your recovery code can read and change your wishlist.</li>
        <li>Your wishlist is kept encrypted on public sync servers, which keep it only as long as they choose. Keep a device signed in, or a backup file, as well.</li>
      </ul>
      <div className="app-row">
        {summary.phase === 'replaced' ? null : (
          <Button variant="ghost" size="md" icon={<RefreshCw />} onClick={() => setSheet('change')}>
            Change recovery code
          </Button>
        )}
        <Button variant="ghost" size="md" icon={<LogOut />} onClick={() => setSheet('signout')}>
          Sign out on this device
        </Button>
      </div>

      <BottomSheet open={sheet === 'change'} onClose={() => setSheet('none')} title="Change your recovery code?">
        <div className="app-stack">
          <p className="app-note">Do this if someone else may have seen your code. The old code stops working, and your other devices stop syncing until you sign them in with the new one.</p>
          <div className="app-row app-row--fill">
            <Button variant="danger" fullWidth loading={busy === 'change'} onClick={() => void changeCode()}>
              Make a new code
            </Button>
            <Button variant="secondary" fullWidth disabled={busy === 'change'} onClick={() => setSheet('none')}>
              Cancel
            </Button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'signout'} onClose={() => setSheet('none')} title="Sign out on this device?">
        <div className="app-stack">
          {summary.unsent > 0 ? <p className="app-note app-note--warning">Some changes made here have not reached your other devices yet.</p> : null}
          <p className="app-note">Your other devices keep everything. To use your Hippo here again later, sign in with your recovery code.</p>
          <div className="account-choices">
            <Button variant="secondary" fullWidth loading={busy === 'keep'} disabled={busy === 'remove'} onClick={() => void signOut(false)}>
              Sign out, keep this copy
            </Button>
            <p className="app-note">Your wishes stay here but no longer change with your other devices.</p>
            <Button variant="danger" fullWidth loading={busy === 'remove'} disabled={busy === 'keep'} onClick={() => void signOut(true)}>
              Sign out and remove this copy
            </Button>
            <p className="app-note">Your wishes, lists and their links are removed from this device only.</p>
          </div>
        </div>
      </BottomSheet>
    </section>
  )
}
