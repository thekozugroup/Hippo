import { useState, type ReactNode } from 'react'
import { ExternalLink, TriangleAlert } from 'lucide-react'
import { Button, DotProgress, ImportanceMark, MoneyText, StatusPill, Thumb } from '../../../ui/index.ts'
import type { ClaimRow, GiverItemView } from '../../../core/index.ts'
import { importanceLevel, safeUrl } from '../../lib/format.ts'
import type { SheetRequest } from './ClaimSheet.tsx'
import { describeRow, fundingProgress, giverStatus, itemHeadingId, rowNeedsText } from './giverText.ts'

export interface GiverItemCardProps {
  view: GiverItemView
  pendingClaimIds: readonly string[]
  onRequest: (r: SheetRequest) => void
  onMarkPurchased: (row: ClaimRow, purchased: boolean) => void
}

/**
 * One of my gifts on a wish: a plain line with its quiet actions, never a box. `text` is null
 * when the status pill already says the same thing.
 */
export function MyGiftLine({ text, pending, entering, children }: { text: string | null; pending?: boolean; entering?: boolean; children: ReactNode }) {
  return (
    <li className={entering ? 'giver-line giver-line--mine motion-enter' : 'giver-line giver-line--mine'}>
      {text ? (
        <span className="giver-line__text">
          {text}
          {pending ? <span className="app-muted"> · not sent yet</span> : null}
        </span>
      ) : pending ? (
        <span className="giver-line__text app-muted">Not sent yet</span>
      ) : (
        <span className="sr-only">Your gift</span>
      )}
      <span className="giver-line__actions">{children}</span>
    </li>
  )
}

/** A giver's card for one wish: what it is, how much, whether it is still open, then the action. */
export function GiverItemCard({ view, pendingClaimIds, onRequest, onMarkPurchased }: GiverItemCardProps) {
  const { item, state } = view
  const href = safeUrl(item.url)
  const myRows = state.rows.filter((r) => r.mine)
  const otherRows = state.rows.filter((r) => !r.mine && rowNeedsText(r, item, state))
  const myConflict = myRows.some((r) => r.conflict)
  const status = giverStatus(item, state)
  const funding = fundingProgress(item, state)
  const remainingAmount = state.remainingAmount ?? 0
  const contributionsOpen = item.allowContributions && item.price !== undefined
  const canClaim = state.pledgeCount === 0 && state.remainingQuantity > 0
  const canPledge = contributionsOpen && remainingAmount > 0
  // "Cover the rest" is a pledge too, so it closes with contributions (the owner switched them off).
  const canCover = contributionsOpen && state.pledgeCount > 0 && remainingAmount > 0
  const closedWithPledges = !item.allowContributions && state.pledgeCount > 0
  const myPledge = myRows.some((r) => r.kind === 'pledge')
  const titleId = itemHeadingId(item.id)
  const main = canClaim ? 'claim' : canCover ? 'cover' : canPledge ? 'pledge' : null
  // What was on the card when it first showed; anything that changes after that enters with a
  // little motion, so a claim is seen to land (the dots fill in DotProgress).
  const [initial] = useState(() => ({ label: status?.label, mine: new Set(myRows.map((r) => r.claimId)) }))

  return (
    <article className="giver-item" aria-labelledby={titleId}>
      <div className="giver-item__head">
        <Thumb name={item.title} src={safeUrl(item.imageUrl)} size="md" />
        <div className="giver-item__main">
          <h3 id={titleId} className="giver-item__title" tabIndex={-1}>
            {item.title}
          </h3>
          <p className="giver-item__meta">
            {item.price ? (
              <span className="giver-item__price">
                <MoneyText money={item.price} />
                {item.quantity > 1 ? <span className="app-muted"> each</span> : null}
              </span>
            ) : null}
            <ImportanceMark level={importanceLevel(item.importance)} />
          </p>
          {status ? (
            <StatusPill key={status.label} status={status.status} label={status.label} className={status.label === initial.label ? 'giver-item__status' : 'giver-item__status motion-enter'} />
          ) : null}
        </div>
      </div>

      {item.quantity > 1 && state.remainingQuantity > 0 && state.remainingQuantity < item.quantity ? (
        <p className="giver-item__line">{`${state.remainingQuantity} of ${item.quantity} still wanted`}</p>
      ) : null}

      {funding ? (
        <div className="giver-item__funding">
          <DotProgress label={`Funding for ${item.title}`} value={funding.value} valueText={funding.text} />
          <p className="giver-item__funding-line">
            <span>{funding.percent}</span>
            <span>{funding.rest}</span>
          </p>
          {funding.surplus ? <p className="giver-item__line">{funding.surplus}</p> : null}
        </div>
      ) : null}

      {otherRows.length > 0 ? (
        <ul className="giver-item__lines" aria-label={`Who is helping with ${item.title}`}>
          {otherRows.map((row) => (
            <li key={row.claimId} className="giver-line">
              <span className="giver-line__text">
                {describeRow(row)}
                {row.currencyMismatch ? ' (different currency, not counted)' : null}
                {row.conflict ? ' (too late, not counted)' : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {closedWithPledges ? (
        <p className="giver-item__line">
          {remainingAmount > 0 && myPledge ? 'Closed to new contributions. You can still lower your amount or take it back.' : 'Closed to new contributions.'}
        </p>
      ) : null}

      {myConflict ? (
        <p className="giver-item__warn" role="note">
          <TriangleAlert aria-hidden="true" size={18} />
          <span>Someone else said they would get this first, so yours is not counted. Take yours back and pick something else.</span>
        </p>
      ) : null}

      {myRows.length > 0 ? (
        <ul className="giver-item__lines giver-item__mine" aria-label={`What you did for ${item.title}`}>
          {myRows.map((row) => (
            <MyGiftLine
              key={row.claimId}
              text={rowNeedsText(row, item, state) ? `${describeRow(row)}${row.conflict ? ' (not counted)' : ''}` : null}
              pending={pendingClaimIds.includes(row.claimId)}
              entering={!initial.mine.has(row.claimId)}
            >
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
              <Button variant="ghost" size="md" aria-describedby={titleId} onClick={() => onRequest({ mode: 'withdraw', title: item.title, claimId: row.claimId, itemId: item.id })}>
                Take back
              </Button>
            </MyGiftLine>
          ))}
        </ul>
      ) : null}

      {main ? (
        <div className="giver-item__actions">
          <Button
            variant="primary"
            size="md"
            aria-describedby={titleId}
            onClick={() => onRequest({ mode: main, view })}
          >
            {main === 'claim' ? "I'll get this" : main === 'cover' ? 'Cover the rest' : 'Chip in'}
          </Button>
          {main !== 'pledge' && canPledge ? (
            <Button variant="ghost" size="md" aria-describedby={titleId} onClick={() => onRequest({ mode: 'pledge', view })}>
              Chip in
            </Button>
          ) : null}
        </div>
      ) : null}

      {item.notes || href ? (
        <div className="giver-item__extra">
          {item.notes ? <p className="giver-item__notes">{item.notes}</p> : null}
          {href ? (
            <a className="giver-item__link" href={href} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" size={16} />
              <span>
                See it at {new URL(href).hostname.replace(/^www\./, '')}
                <span className="sr-only"> (opens in a new tab)</span>
              </span>
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
