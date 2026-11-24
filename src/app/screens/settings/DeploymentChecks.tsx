import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { Button, Skeleton, StatusPill } from '../../../ui/index.ts'
import { browserDeploymentEnv, checkDeployment, DEFAULT_RELAYS, type DeploymentCheck } from '../../../core/index.ts'
import { useCore } from '../../core/context.ts'
import { useSettings } from '../../core/data.ts'
import { HOSTING_GUIDE_URL } from '../../lib/hosting.ts'
import { isNativeApp } from '../../native/platform.ts'

/** Version check and the automatic update helper: website only, loaded when this section is opened. */
const UpdatesPanel = lazy(() => import('./UpdatesPanel.tsx'))

/** Inside the Android app the files come from the APK: the address, service worker and storage promise checks are about a browser tab, so they are left out. */
const NATIVE_SKIP = ['own-origin', 'service-worker', 'persistent-storage'] as const

/** The relay check has its own timeout; this is the cap for anything else that hangs. */
const GIVE_UP_MS = 12_000

/** `checks` keeps the last results while checking again, so the list does not jump. */
interface State {
  phase: 'idle' | 'pending' | 'done' | 'stuck'
  checks: DeploymentCheck[] | null
}

const ORDER: Record<DeploymentCheck['status'], number> = { problem: 0, warning: 1, unknown: 2, ok: 3 }

/** Problems first, then warnings, then checks that could not run, then the rest; ties keep their order. */
function sortChecks(checks: readonly DeploymentCheck[]): DeploymentCheck[] {
  return checks.map((c, i) => [c, i] as const).sort(([a, i], [b, j]) => ORDER[a.status] - ORDER[b.status] || i - j).map(([c]) => c)
}

function summary({ phase, checks }: State): string {
  if (phase === 'idle') return ''
  if (phase === 'pending') return 'Checking…'
  if (phase === 'stuck' || !checks) return 'The checks did not finish. Try again.'
  const bad = checks.filter((c) => c.status === 'problem' || c.status === 'warning').length
  const unknown = checks.filter((c) => c.status === 'unknown').length
  if (bad === 0 && unknown === 0) return `All ${checks.length} checks passed.`
  return [bad > 0 ? `${bad} of ${checks.length} need attention.` : '', unknown > 0 ? `${unknown} could not be checked.` : ''].filter(Boolean).join(' ')
}

function Row({ check }: { check: DeploymentCheck }) {
  const ok = check.status === 'ok'
  return (
    <li className="settings-check">
      {ok ? null : check.status === 'unknown' ? <StatusPill status="draft" label="Could not check" /> : <StatusPill status="conflict" label="Needs attention" />}
      <p className="settings-check__finding">{check.finding}</p>
      {!ok && check.fix ? <p className="settings-check__fix">{check.fix}</p> : null}
    </li>
  )
}

export interface DeploymentChecksProps {
  /** Runs the checks. Defaults to the real ones for the relays this copy uses; tests pass their own. */
  run?: () => Promise<DeploymentCheck[]>
}

/**
 * "Deployment checks": for whoever set up this copy of Hippo. Collapsed by default; the checks run
 * when it is opened and on "Check again". The result is announced in a polite live region.
 */
export function DeploymentChecks({ run }: DeploymentChecksProps) {
  const core = useCore()
  const settings = useSettings()
  const [state, setState] = useState<State>({ phase: 'idle', checks: null })
  const [open, setOpen] = useState(false)
  // Only the latest run may write; leaving the screen ends them all.
  const token = useRef(0)
  useEffect(() => () => void token.current++, [])

  const relays = core.forcedRelays ?? settings?.relays ?? [...DEFAULT_RELAYS]

  const start = () => {
    const mine = ++token.current
    setState((prev) => ({ phase: 'pending', checks: prev.checks }))
    let timer: ReturnType<typeof setTimeout> | undefined
    const gaveUp = new Promise<'stuck'>((resolve) => {
      timer = setTimeout(() => resolve('stuck'), GIVE_UP_MS)
    })
    const job = (run ?? (() => checkDeployment({ ...browserDeploymentEnv(relays), ...(isNativeApp() ? { skip: NATIVE_SKIP } : {}) })))().catch((): 'stuck' => 'stuck')
    void Promise.race([job, gaveUp]).then((r) => {
      clearTimeout(timer)
      if (token.current !== mine) return
      setState((prev) => (r === 'stuck' ? { phase: 'stuck', checks: prev.checks } : { phase: 'done', checks: sortChecks(r) }))
    })
  }

  const pending = state.phase === 'pending'
  const rows = state.checks

  return (
    <section aria-labelledby="set-deploy">
      <details
        className="settings-deploy"
        open={open}
        onToggle={(e) => {
          const now = e.currentTarget.open
          if (now === open) return
          setOpen(now)
          if (now && state.phase === 'idle') start()
        }}
      >
        <summary id="set-deploy" className="settings-deploy__summary">
          <span>Deployment checks</span>
          <ChevronDown className="settings-deploy__chevron" aria-hidden="true" />
        </summary>
        <div className="app-stack settings-deploy__body">
          <p className="app-note">For whoever set up this copy of Hippo. A relay is a sync server that carries shared lists.</p>
          {isNativeApp() ? null : (
            <p className="app-note">
              <a href={HOSTING_GUIDE_URL} target="_blank" rel="noopener noreferrer">
                Host your own copy of Hippo<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          )}
          <p className="settings-deploy__status" role="status" aria-live="polite">
            {summary(state)}
          </p>
          {rows ? (
            <ul className="settings-checks" role="list" aria-busy={pending || undefined}>
              {rows.map((c) => (
                <Row key={c.id} check={c} />
              ))}
            </ul>
          ) : state.phase === 'stuck' ? null : (
            <div className="settings-checks" aria-hidden="true">
              <Skeleton height={20} />
              <Skeleton height={20} />
              <Skeleton height={20} />
            </div>
          )}
          <div>
            <Button variant="secondary" size="md" icon={<RefreshCw />} loading={pending} onClick={start}>
              Check again
            </Button>
          </div>
          {open && !isNativeApp() ? (
            <Suspense fallback={null}>
              <UpdatesPanel />
            </Suspense>
          ) : null}
        </div>
      </details>
    </section>
  )
}
