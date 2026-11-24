import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Button, TextField } from '../../../ui/index.ts'
import template from '../../../../scripts/hosting/hippo-update.yml?raw'
import { AUTO_UPDATE_GUIDE_URL, checkForUpdate, newWorkflowFileUrl, parseRepository, UPDATE_WORKFLOW_PATH, type UpdateCheck } from '../../lib/auto-update.ts'

export interface UpdatesPanelProps {
  /** This copy's version. Defaults to the one it was built with. */
  version?: string
  /** Compares with the original's stable version. Tests pass their own; the real one asks GitHub. */
  check?: (current: string) => Promise<UpdateCheck>
  /** Opens a link in a new tab. Tests pass their own. */
  openUrl?: (url: string) => void
}

type CheckState = { phase: 'idle' } | { phase: 'pending' } | { phase: 'done'; result: UpdateCheck }

function resultText(version: string, state: CheckState): string {
  if (state.phase === 'idle') return ''
  if (state.phase === 'pending') return 'Checking…'
  const r = state.result
  switch (r.status) {
    case 'behind':
      return `Version ${r.latest} is available. This copy has ${version}. With automatic updates on, it arrives within a day.`
    case 'current':
      return `This copy is up to date. ${version} is the newest version.`
    case 'ahead':
      return `This copy (${version}) is newer than the newest stable version (${r.latest}).`
    case 'failed':
      return r.reason === 'offline' ? 'GitHub could not be reached. Check your internet connection and try again.' : 'GitHub did not send a version. Try again later.'
  }
}

function openInNewTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Updates, inside Deployment checks (website only, loaded when that section is opened): this copy's
 * version, a check against the original's stable branch that runs only when pressed, and the helper
 * that opens GitHub's new-file page with the automatic update workflow filled in. The repository
 * name the owner types stays in this component; it is never stored or sent anywhere but GitHub.
 */
export default function UpdatesPanel({ version = __HIPPO_VERSION__, check = checkForUpdate, openUrl = openInNewTab }: UpdatesPanelProps) {
  const [state, setState] = useState<CheckState>({ phase: 'idle' })
  const [repo, setRepo] = useState('')
  const [error, setError] = useState('')
  const [opened, setOpened] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const runCheck = () => {
    setState({ phase: 'pending' })
    void check(version)
      .catch((): UpdateCheck => ({ status: 'failed', reason: 'offline' }))
      .then((result) => {
        if (alive.current) setState({ phase: 'done', result })
      })
  }

  const openGitHub = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const parsed = parseRepository(repo)
    if (!parsed.ok) {
      setError(parsed.error)
      setOpened('')
      return
    }
    setError('')
    openUrl(newWorkflowFileUrl(parsed.repository, template))
    setOpened(`GitHub opened in a new tab for ${parsed.repository}. Press Commit changes there.`)
  }

  return (
    <div className="app-stack settings-updates">
      <h3 className="settings-updates__title">Updates</h3>
      <p className="app-note">
        This copy of Hippo is version <strong>{version}</strong>.
      </p>
      <div>
        <Button variant="secondary" size="md" icon={<RefreshCw />} loading={state.phase === 'pending'} onClick={runCheck}>
          Check for a newer version
        </Button>
      </div>
      <p className="settings-updates__status" aria-live="polite">
        {resultText(version, state)}
      </p>
      <p className="app-note">This asks GitHub for the newest version number. Nothing about you or your lists is sent.</p>

      <h3 className="settings-updates__title">Turn on automatic updates</h3>
      <p className="app-note">
        Add one file to your copy on GitHub, and it checks for a new version every day and updates itself. Type your copy&rsquo;s repository, then press <strong>Commit changes</strong> on the
        page that opens.
      </p>
      <form className="app-stack" onSubmit={openGitHub} noValidate>
        <TextField
          label="Your repository"
          hint="Your GitHub name and the repository name, for example ada/hippo."
          value={repo}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={200}
          onChange={(e) => {
            setRepo(e.target.value)
            if (error) setError('')
          }}
          {...(error ? { error } : {})}
        />
        <div>
          <Button type="submit" variant="secondary" size="md" icon={<ExternalLink />}>
            Open GitHub to add the file<span className="sr-only"> (opens in a new tab)</span>
          </Button>
        </div>
      </form>
      <p className="settings-updates__status" aria-live="polite">
        {opened}
      </p>
      <p className="app-note">
        The file is <code>{UPDATE_WORKFLOW_PATH}</code>. It lets the Hippo project change your copy&rsquo;s code, and only takes versions that passed all of the project&rsquo;s checks. To
        stop updates, delete the file.{' '}
        <a href={AUTO_UPDATE_GUIDE_URL} target="_blank" rel="noopener noreferrer">
          How automatic updates work<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    </div>
  )
}
