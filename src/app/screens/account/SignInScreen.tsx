// "Sign in with my recovery code". The words are checked on this device (the checksum catches a
// wrong or swapped word); nothing is sent anywhere until they add up. Data already here is merged
// with the account on the first sync, never replaced.

import { useState } from 'react'
import { useLocation } from 'wouter'
import { LogIn } from 'lucide-react'
import { Button, TextArea } from '../../../ui/index.ts'
import { parseRecoveryCode } from '../../../core/account/recovery-code.ts'
import { isAccountError, signInToAccount } from '../../../core/account/service.ts'
import { useCore } from '../../core/context.ts'
import { useNotify } from '../../core/notify.ts'
import { useSettings } from '../../core/data.ts'
import { writeSetupHint } from '../../core/setupHint.ts'
import { startAccountSync } from '../../core/account.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { codeProblemText } from './account-text.ts'

export default function SignInScreen() {
  const core = useCore()
  const notify = useNotify()
  const settings = useSettings()
  const [, navigate] = useLocation()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const inSetup = settings?.onboarding === undefined || settings.onboarding.status === 'active'

  const submit = async () => {
    if (busy) return
    const r = parseRecoveryCode(text)
    if (!r.ok) {
      setError(codeProblemText(r))
      return
    }
    setError(undefined)
    setBusy(true)
    try {
      await signInToAccount(core, r.secret, { codeSaved: true })
      writeSetupHint(true, core.db.name)
      await startAccountSync(core)
      notify('Signed in. Your wishes and lists are on their way.')
      navigate('/', { replace: true })
    } catch (e) {
      setError(isAccountError(e, 'other-account') ? 'This device is signed in to a different Hippo. Sign out on this device in Settings first.' : 'Signing in did not work. Please try again.')
      setBusy(false)
    }
  }

  return (
    <AppScreen {...(inSetup ? {} : { area: 'settings' as const })} title="Sign in with your recovery code" back={inSetup ? '#/existing' : '#/settings'} backLabel="Back">
      <form
        className="app-stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <p className="app-note">Enter the 13 words from your other device or from where you saved them. Wishes and lists already on this device stay, and are added to the rest.</p>
        <TextArea
          label="Recovery code"
          value={text}
          rows={4}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          translate="no"
          onChange={(e) => {
            setText(e.target.value)
            if (error) setError(undefined)
          }}
          onBlur={() => {
            if (!text.trim()) return
            const r = parseRecoveryCode(text)
            setError(r.ok ? undefined : codeProblemText(r))
          }}
          {...(error ? { error } : {})}
        />
        <div>
          <Button type="submit" variant="primary" icon={<LogIn />} loading={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
    </AppScreen>
  )
}
