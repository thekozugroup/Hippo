// Pointing the app at a Hippo website, in two choices: "I have a Hippo site" (type the address, which
// is checked) and "Set one up, free, about two minutes" (three short steps and a button that opens
// the setup page in the phone's browser). One component for the guided screen before a first share,
// "Use my own Hippo site" under "I already use Hippo", and Settings. Android app only; it is reached
// only through code that checks isNativeApp(), and is loaded on demand.

import { useState, type ReactNode } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import { Button, SegmentedControl, TextField } from '../../../ui/index.ts'
import { useCore } from '../../core/context.ts'
import { connectSite } from '../../lib/connect-site.ts'
import type { FileFetcher } from '../../lib/site-check.ts'
import { DEPLOY_URL } from '../../lib/hosting.ts'
import { siteFileFetcher } from '../../native/index.ts'
import './move.css'

export type SiteChoice = 'have' | 'new'

export interface ConnectedSite {
  host: string
  url: string
}

export interface SiteSetupProps {
  /** The sentence above the two choices: why the app needs a web address. */
  intro: ReactNode
  /** Called after the address was checked and saved. */
  onConnected: (site: ConnectedSite) => void
  /** Offers to carry on without a site (the guided screen before sharing). */
  skip?: { label: string; onSkip: () => void }
  /** The choice shown first. */
  initialChoice?: SiteChoice
  /** Reads hippo.json; the app's native fetch unless a test passes its own. */
  fetchFile?: FileFetcher
}

const CHOICES = [
  { value: 'have', label: 'I have a Hippo site' },
  { value: 'new', label: 'Set one up, free, about two minutes' },
] as const

export function SiteSetup({ intro, onConnected, skip, initialChoice = 'have', fetchFile }: SiteSetupProps) {
  const core = useCore()
  const [choice, setChoice] = useState<SiteChoice>(initialChoice)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [checking, setChecking] = useState(false)

  const submit = async () => {
    if (checking) return
    const fetcher = fetchFile ?? siteFileFetcher()
    if (!fetcher) {
      setError('Only the Android app can change its Hippo site.')
      return
    }
    setChecking(true)
    setError(undefined)
    const r = await connectSite(core, text, fetcher)
    setChecking(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setText('')
    onConnected({ host: r.host, url: r.url })
  }

  return (
    <div className="app-stack">
      <p className="app-note">{intro}</p>
      <SegmentedControl className="site-choice" label="Your Hippo site" options={CHOICES} value={choice} onChange={setChoice} />
      {choice === 'have' ? (
        <form
          className="app-stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <TextField
            label="Hippo website address"
            value={text}
            inputMode="url"
            autoComplete="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="hippo.example.com"
            onChange={(e) => setText(e.target.value)}
            {...(error ? { error } : {})}
          />
          <div className="app-row">
            <Button type="submit" variant="primary" icon={<Check />} loading={checking}>
              Check and use
            </Button>
          </div>
        </form>
      ) : (
        <div className="app-stack">
          <ol className="app-steps">
            <li>Open the setup page and sign in with GitHub. It is free.</li>
            <li>Follow the steps there. Vercel makes your own copy of Hippo and puts it online.</li>
            <li>Come back here, choose I have a Hippo site, and type the address it gives you.</li>
          </ol>
          <div className="app-row">
            <a className="btn btn--primary btn--md" href={DEPLOY_URL} target="_blank" rel="noopener noreferrer">
              <span className="btn__icon" aria-hidden="true">
                <ExternalLink />
              </span>
              <span className="btn__label">
                Open the setup page<span className="sr-only"> (opens in your browser)</span>
              </span>
            </a>
          </div>
        </div>
      )}
      {skip ? (
        <div className="app-row">
          <Button type="button" variant="ghost" onClick={skip.onSkip}>
            {skip.label}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
