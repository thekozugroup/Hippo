import { ExternalLink, TriangleAlert } from 'lucide-react'
import { Button, DotProgress, ImportanceMark, MoneyText, StatusPill, Thumb, type Status } from '../../../ui/index.ts'
import type { ClaimRow, GiverItemView } from '../../../core/index.ts'
import { importanceLevel, moneyText, safeUrl } from '../../lib/format.ts'
import type { SheetRequest } from './ClaimSheet.tsx'
import { describeRow, fundingProgress } from './giverText.ts'

export interface GiverItemCardProps {
  view: GiverItemView
  pendingClaimIds: readonly string[]
  onRequest: (r: SheetRequest) => void
  onMarkPurchased: (row: ClaimRow, purchased: boolean) => void
}

export function GiverItemCard({ view, pendingClaimIds, onRequest, onMarkPurchased }: GiverItemCardProps) {
  const { item, state } = view
  const href = safeUrl(item.url)
  const myRows = state.rows.filter((r) => r.mine)
  const myConflict = myRows.some((r) => r.conflict)
  const status: Status = myConflict ? 'conflict' : state.status
  const funding = fundingProgress(item, state)
  const remainingAmount = state.remainingAmount ?? 0
  const canClaim = state.pledgeCount === 0 && state.remainingQuantity > 0
  const canPledge = item.allowContributions && item.price !== undefined && remainingAmount > 0
  const canCover = state.pledgeCount > 0 && item.price !== undefined && remainingAmount > 0
  const titleId = `item-${item.id}`

  return (
    <article className="giver-item" aria-labelledby={titleId}>
      <div className="giver-item__head">
        <Thumb name={item.title} src={safeUrl(item.imageUrl)} size="lg" />
        <div className="giver-item__main">
          <h3 id={titleId} className="giver-item__title">
            {item.title}
          </h3>
          <div className="giver-item__meta">
            <ImportanceMark level={importanceLevel(item.importance)} />
            {item.price ? (
              <span className="giver-item__price">
                <MoneyText money={item.price} />
                {item.quantity > 1 ? <span className="app-muted"> each</span> : null}
              </span>
            ) : null}
          </div>
        </div>
        <StatusPill status={status} className="giver-item__status" />
      </div>

      {item.notes ? <p className="giver-item__notes">{item.notes}</p> : null}

      {href ? (
        <a className="giver-item__link" href={href} target="_blank" rel="noopener noreferrer">
          <ExternalLink aria-hidden="true" size={18} />
          <span>
            See it at {new URL(href).hostname.replace(/^www\./, '')}
            <span className="sr-only"> (opens in a new tab)</span>
          </span>
        </a>
      ) : null}

      {item.quantity > 1 ? (
        <p className="app-note">{state.remainingQuantity === 0 ? `All ${item.quantity} are taken care of.` : `${state.remainingQuantity} of ${item.quantity} still wanted.`}</p>
      ) : null}

      {funding ? (
        <div className="giver-item__funding">
          <DotProgress label={`Funding for ${item.title}`} value={funding.value} valueText={funding.text} columns={16} showValue />
          <p className="app-note">{funding.text}</p>
          {state.surplus > 0 && state.target ? (
            <p className="app-note">{`${moneyText({ amount: state.surplus, currency: state.target.currency })} more than needed has been pledged.`}</p>
          ) : null}
          {!item.allowContributions && state.pledgeCount > 0 ? <p className="app-note">New contributions are closed for this wish.</p> : null}
        </div>
      ) : null}

      {myConflict ? (
        <div className="app-banner app-banner--warn" role="note">
          <TriangleAlert aria-hidden="true" />
          <p>Someone else marked this a moment before you, so your mark did not count. You can take it back.</p>
        </div>
      ) : null}

      {state.rows.length > 0 ? (
        <ul className="giver-item__rows" aria-label={`Who is helping with ${item.title}`}>
          {state.rows.map((row) => (
            <li key={row.claimId} className={row.mine ? 'giver-row giver-row--mine' : 'giver-row'}>
              <span className="giver-row__text">
                {describeRow(row)}
                {row.currencyMismatch ? <span className="app-muted"> (different currency, not counted)</span> : null}
                {row.conflict && !row.mine ? <span className="app-muted"> (too late, not counted)</span> : null}
                {row.mine && pendingClaimIds.includes(row.claimId) ? <span className="app-muted"> · not sent yet</span> : null}
              </span>
              {row.mine ? (
                <span className="giver-row__actions">
                  {!row.conflict ? (
                    <Button variant="ghost" size="md" aria-describedby={titleId} onClick={() => onMarkPurchased(row, row.status !== 'purchased')}>
                      {row.status === 'purchased' ? 'Not bought yet' : 'Mark bought'}
                    </Button>
                  ) : null}
                  {!row.conflict ? (
                    <Button variant="ghost" size="md" aria-describedby={titleId} onClick={() => onRequest({ mode: 'edit', view, row })}>
                      Change
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="md" aria-describedby={titleId} onClick={() => onRequest({ mode: 'withdraw', title: item.title, claimId: row.claimId })}>
                    Take back
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canClaim || canPledge || canCover ? (
        <div className="app-row app-row--nowrap giver-item__actions">
          {canClaim ? (
            <Button variant="primary" size="md" fullWidth aria-describedby={titleId} onClick={() => onRequest({ mode: 'claim', view })}>
              I&apos;ll get this
            </Button>
          ) : canCover ? (
            <Button variant="primary" size="md" fullWidth aria-describedby={titleId} onClick={() => onRequest({ mode: 'cover', view })}>
              Cover the rest
            </Button>
          ) : null}
          {canPledge ? (
            <Button variant="secondary" size="md" fullWidth aria-describedby={titleId} onClick={() => onRequest({ mode: 'pledge', view })}>
              Chip in
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
