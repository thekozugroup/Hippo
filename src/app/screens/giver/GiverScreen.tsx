import { useState, type ReactNode } from 'react'
import { CloudOff, EyeOff, Gift, Link2Off, LockKeyhole, UserRound } from 'lucide-react'
import { useLocation } from 'wouter'
import { Button, Chip, EmptyState, LinkButton, SectionHeader, Skeleton, StatusPill, TwoTone } from '../../../ui/index.ts'
import { removeGuestList, type ClaimRow, type GiverListSession, type GiverListView } from '../../../core/index.ts'
import { useCore } from '../../core/context.ts'
import { useGiverSession, useGiverView, type GiverSource } from '../../core/giver.ts'
import { useNotify } from '../../core/notify.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { formatEventDate } from '../../lib/format.ts'
import { ClaimSheet, type SheetRequest } from './ClaimSheet.tsx'
import { GiverItemCard } from './GiverItemCard.tsx'
import { actionErrorMessage, describeRow } from './giverText.ts'
import './GiverScreen.css'

function Banner({ icon, title, children, warn }: { icon: ReactNode; title: string; children?: ReactNode; warn?: boolean }) {
  return (
    <div className={warn ? 'app-banner app-banner--warn' : 'app-banner'} role="status">
      {icon}
      <div className="app-banner__body">
        <p className="app-banner__title">{title}</p>
        {children}
      </div>
    </div>
  )
}

function GiverList({ session, view }: { session: GiverListSession; view: GiverListView }) {
  const core = useCore()
  const notify = useNotify()
  const [, navigate] = useLocation()
  const [request, setRequest] = useState<SheetRequest | null>(null)
  const meta = view.meta
  const available = view.items.filter((v) => v.state.status === 'available' || v.state.status === 'partial').length

  const markPurchased = async (row: ClaimRow, purchased: boolean) => {
    try {
      const r = await session.markPurchased(row.claimId, purchased)
      notify(!r.result.ok ? 'Saved on this device. Hippo will send it when you are back online.' : purchased ? 'Marked as bought.' : 'Marked as not bought yet.')
    } catch (e) {
      notify(actionErrorMessage(e))
    }
  }

  const forget = async () => {
    session.stop()
    await removeGuestList(core.db, view.topic)
    notify('Removed from this device.')
    navigate('/lists')
  }

  const title = meta?.name ?? (view.status === 'loading' ? 'Opening list…' : 'Shared list')
  const intro = meta ? (
    <>
      {meta.eventDate ? <p className="giver-date">{formatEventDate(meta.eventDate)}</p> : null}
      {meta.message ? <p className="giver-message">{meta.message}</p> : null}
    </>
  ) : null

  return (
    <AppScreen
      title={title}
      compactTitle
      intro={intro}
      back="#/lists"
      backLabel="Lists shared with me"
      busy={view.status === 'loading' && !meta}
      actions={
        meta ? (
          <Chip tone="frost" avatar={<UserRound size={16} />} onClick={() => setRequest({ mode: 'nickname', ...(view.nickname ? { current: view.nickname } : {}) })} aria-label={`Your name on this list: ${view.nickname ?? 'Someone'}. Change`}>
            {view.nickname ?? 'Someone'}
          </Chip>
        ) : undefined
      }
    >
      {view.status === 'offline' ? (
        <Banner icon={<CloudOff aria-hidden="true" />} title={meta ? 'You are offline' : 'Cannot reach this list right now'}>
          <p>{meta ? 'Showing what was saved on this device. Hippo keeps trying and updates when it can.' : 'Check your connection. Hippo keeps trying in the background.'}</p>
        </Banner>
      ) : null}

      {view.status === 'loading' && !meta ? (
        <div className="app-stack" aria-label="Loading the list">
          <Skeleton height={120} shape="tile" />
          <Skeleton height={120} shape="tile" />
        </div>
      ) : null}

      {view.status === 'live' && !meta ? (
        <EmptyState
          icon={<Link2Off />}
          title={<TwoTone muted="Nothing here yet." bright="We could not find this list." />}
          description="It may not be shared yet, or the link was replaced with a new one. Ask the person who sent it for the latest link."
        />
      ) : null}

      {view.status === 'unpublished' ? (
        <EmptyState
          icon={<EyeOff />}
          title={<TwoTone muted="Sharing stopped." bright="This list is no longer shared." />}
          description="The owner stopped sharing it or made a new link. If you still want to help, ask them for the new link."
        />
      ) : null}

      {meta && view.status !== 'unpublished' ? (
        <section className="app-stack" aria-labelledby="giver-items">
          <div className="app-row app-row--between">
            <h2 id="giver-items" className="app-section-title">
              Wishes
            </h2>
            <span className="app-note">{`${available} still open`}</span>
          </div>
          {view.items.length === 0 ? (
            <p className="app-note">There is nothing on this list yet. Check back later.</p>
          ) : (
            <div className="giver-items">
              {view.items.map((v) => (
                <GiverItemCard
                  key={v.item.id}
                  view={v}
                  pendingClaimIds={view.pendingClaimIds}
                  onRequest={setRequest}
                  onMarkPurchased={(row, p) => void markPurchased(row, p)}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {view.removedItemsWithMyClaims.length > 0 ? (
        <section className="app-stack" aria-labelledby="giver-removed">
          <SectionHeader title={<span id="giver-removed">Removed by the owner</span>} />
          <p className="app-note">These were taken off the list after you marked them. Your marks are kept here so you know what you promised.</p>
          {view.removedItemsWithMyClaims.map((r) => (
            <article key={r.itemId} className="giver-item" aria-label={r.item?.title ?? 'A removed wish'}>
              <div className="app-row app-row--between">
                <h3 className="giver-item__title">{r.item?.title ?? 'A removed wish'}</h3>
                <StatusPill status="removed" />
              </div>
              <ul className="giver-item__rows">
                {r.myClaims.map((c) => (
                  <li key={c.id} className="giver-row giver-row--mine">
                    <span className="giver-row__text">
                      {describeRow({
                        claimId: c.id,
                        eventId: '',
                        kind: c.kind,
                        quantity: c.kind === 'full' ? (c.quantity ?? 1) : 0,
                        ...(c.amount ? { amount: c.amount } : {}),
                        status: c.status === 'purchased' ? 'purchased' : 'reserved',
                        mine: true,
                        conflict: false,
                        currencyMismatch: false,
                        createdAt: c.createdAt,
                      })}
                    </span>
                    <span className="giver-row__actions">
                      <Button variant="ghost" size="md" onClick={() => setRequest({ mode: 'withdraw', title: r.item?.title ?? 'This wish', claimId: c.id })}>
                        Take back
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ) : null}

      <section className="app-stack giver-foot" aria-label="About this list">
        <p className="app-note giver-privacy">
          <LockKeyhole aria-hidden="true" size={16} /> The list owner cannot see who is getting what. Other friends with the link can.
        </p>
        <div>
          <Button variant="ghost" size="md" onClick={() => void forget()}>
            Remove from this device
          </Button>
        </div>
      </section>

      <ClaimSheet request={request} session={session} onClose={() => setRequest(null)} />
    </AppScreen>
  )
}

function GiverReady({ session }: { session: GiverListSession }) {
  const view = useGiverView(session)
  if (!view) return null
  return <GiverList session={session} view={view} />
}

export function GiverScreen({ source }: { source: GiverSource }) {
  const state = useGiverSession(source)

  if (state.kind === 'ready') return <GiverReady key={state.session.topic} session={state.session} />

  if (state.kind === 'opening') {
    return (
      <AppScreen title="Opening list…" compactTitle back="#/lists" backLabel="Lists" busy>
        <div className="app-stack">
          <Skeleton height={120} shape="tile" />
          <Skeleton height={120} shape="tile" />
        </div>
      </AppScreen>
    )
  }

  if (state.kind === 'own-list') {
    return (
      <AppScreen title="This is your own list" compactTitle back="#/lists" backLabel="Lists">
        <EmptyState
          icon={<Gift />}
          title={<TwoTone muted="No peeking!" bright="Hippo keeps gifts a surprise." />}
          description="You made this list on this device, so Hippo will not show what friends have marked. Send the link to others; they can open it on their own phones."
          action={
            state.listId ? (
              <LinkButton href={`#/list/${state.listId}`} variant="primary">
                Open list settings
              </LinkButton>
            ) : (
              <LinkButton href="#/lists" variant="primary">
                Go to your lists
              </LinkButton>
            )
          }
        />
      </AppScreen>
    )
  }

  if (state.kind === 'invalid-link') {
    return (
      <AppScreen title="This link does not work" compactTitle back="#/" backLabel="Home">
        <EmptyState
          icon={<Link2Off />}
          title={<TwoTone muted="Sorry." bright="This link looks incomplete." />}
          description="Part of it may have been cut off when it was copied. Ask the person who sent it to send the whole link again."
          action={
            <LinkButton href="#/" variant="secondary">
              Go to Hippo home
            </LinkButton>
          }
        />
      </AppScreen>
    )
  }

  return (
    <AppScreen title="List not available" compactTitle back="#/lists" backLabel="Lists">
      <EmptyState
        icon={<Link2Off />}
        title={<TwoTone muted="Sorry." bright="This list could not be opened." />}
        description={
          state.kind === 'not-found'
            ? 'It is no longer saved on this device. Open the link you were sent to add it again.'
            : 'Something went wrong while opening it. Reload the page to try again.'
        }
        action={
          <LinkButton href="#/lists" variant="secondary">
            Go to lists
          </LinkButton>
        }
      />
    </AppScreen>
  )
}
