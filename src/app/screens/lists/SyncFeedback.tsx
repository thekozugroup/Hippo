import { CheckCircle2, CloudOff } from 'lucide-react'
import { hostOf, type SyncSummary } from '../../lib/format.ts'

/** Per-server outcome of the last publish or update, in plain words. */
export function SyncFeedback({ summary }: { summary: SyncSummary }) {
  if (summary.empty) {
    return <p className="app-note motion-enter">Everything was already up to date.</p>
  }
  const all = summary.accepted === summary.total
  const none = summary.accepted === 0
  return (
    <div className={none ? 'app-banner app-banner--warn motion-enter' : 'app-banner motion-enter'}>
      {none ? <CloudOff aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
      <div className="app-banner__body">
        <p className="app-banner__title">
          {none
            ? 'Not sent yet. Hippo keeps trying in the background.'
            : all
              ? `Saved to ${summary.total === 1 ? 'the sync server' : `all ${summary.total} sync servers`}.`
              : `Saved to ${summary.accepted} of ${summary.total} sync servers.`}
        </p>
        {!none && !all ? <p>That is enough for friends to see it.</p> : null}
        <details className="app-details">
          <summary>Details</summary>
          <ul className="sync-servers">
            {summary.servers.map((s) => (
              <li key={s.relay}>
                <span className="sync-servers__host">{hostOf(s.relay)}</span>
                <span className={s.ok ? 'sync-servers__ok' : 'sync-servers__fail'}>{s.ok ? 'Saved' : 'Failed'}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  )
}
