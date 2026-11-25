// "Your recovery code": the account secret as 13 words. Opening it turns the account on for a new
// person (it is made the first time it is needed). Copy, save as a small text file, and confirm it
// was saved; until then nothing in Hippo says the wishlist is safe on other devices.

import { useEffect, useState } from 'react'
import { Check, Copy, FileDown } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button } from '../../../ui/index.ts'
import { accountSecret, ensureAccount, isAccountError, markRecoveryCodeSaved } from '../../../core/account/service.ts'
import { recoveryWords } from '../../../core/account/recovery-code.ts'
import { getRecoverySavedAt } from '../../../core/account/state.ts'
import { useCore } from '../../core/context.ts'
import { useNotify } from '../../core/notify.ts'
import { startAccountSync } from '../../core/account.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { isNativeApp } from '../../native/platform.ts'
import { builtSiteAddress } from './address.ts'
import { RECOVERY_FILE_NAME, recoveryFileText } from './account-text.ts'
import './account.css'

function saveTextFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export default function RecoveryCodeScreen() {
  const core = useCore()
  const notify = useNotify()
  const [words, setWords] = useState<string[] | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const savedAt = useLiveQuery(async () => (await getRecoverySavedAt(core.db)) ?? null, [core])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const secret = (await accountSecret(core.db)) ?? (await ensureAccount(core))
        void startAccountSync(core)
        if (!cancelled) setWords(recoveryWords(secret))
      } catch (e) {
        if (!cancelled) setError(isAccountError(e, 'replaced') ? 'Your recovery code was changed on another device. Sign in with the new code in Settings first.' : 'Your recovery code could not be made on this device. Please try again.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [core])

  const copy = async () => {
    if (!words) return
    try {
      await navigator.clipboard.writeText(words.join(' '))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
      notify('Recovery code copied. Paste it somewhere private.')
    } catch {
      notify('Copy did not work here. Write the words down instead.')
    }
  }

  const confirm = async () => {
    if (saving) return
    setSaving(true)
    try {
      await markRecoveryCodeSaved(core)
      notify('Thanks. Use this code to sign in on your other devices.')
      window.history.back()
    } catch {
      notify('That did not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppScreen area="settings" title="Your recovery code" back="#/settings" backLabel="Back to Settings" busy={words === null && !error}>
      <section className="app-stack" aria-labelledby="code-what">
        <h2 id="code-what" className="sr-only">
          What it is for
        </h2>
        <p className="app-note">Your recovery code opens your wishlist and lists on another phone or browser.</p>
        <p className="app-note">Hippo cannot recover it for you, and anyone who has it can read and change your wishlist, so keep it private.</p>
      </section>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {words ? (
        <section className="app-stack motion-enter" aria-labelledby="code-words">
          <h2 id="code-words" className="app-section-title">
            13 words, in this order
          </h2>
          <ol className="recovery-words" translate="no" data-testid="recovery-code">
            {words.map((w, i) => (
              <li key={i} className="recovery-words__word">
                <span className="recovery-words__n" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="recovery-words__text">{w}</span>
              </li>
            ))}
          </ol>
          <div className="app-row app-row--fill">
            <Button variant="secondary" size="md" fullWidth icon={copied ? <Check /> : <Copy />} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy code'}
            </Button>
            {isNativeApp() ? null : (
              <Button variant="secondary" size="md" fullWidth icon={<FileDown />} onClick={() => saveTextFile(RECOVERY_FILE_NAME, recoveryFileText(words, builtSiteAddress()))}>
                Save as a file
              </Button>
            )}
          </div>
        </section>
      ) : null}

      {words ? (
        savedAt === undefined ? null : savedAt === null ? (
          <div>
            <Button variant="primary" loading={saving} onClick={() => void confirm()}>
              I have saved it
            </Button>
          </div>
        ) : (
          <p className="app-note">{`You saved this code on ${new Date(savedAt).toLocaleDateString()}.`}</p>
        )
      ) : null}
    </AppScreen>
  )
}
