import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CloudOff, Copy, LockKeyhole, Share2, UserRound, X } from 'lucide-react'
import { useLocation } from 'wouter'
import { BottomSheet, Button, Chip, EmptyState, IconButton, LinkButton, SectionHeader, Skeleton, StatusPill, TextField, TwoTone } from '../../../ui/index.ts'
import {
  buildGuestShareLink,
  getGuestList,
  hideGuestList,
  LIMITS,
  markSeen,
  type ClaimPayload,
  type ClaimRow,
  type GiverListSession,
  type GiverListView,
} from '../../../core/index.ts'
import { useCore } from '../../core/context.ts'
import { useAddGuestLink, useGiverSession, useGiverView, type GiverProblem } from '../../core/giver.ts'
import { useSettings } from '../../core/data.ts'
import { useNotify } from '../../core/notify.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { ScreenMessage } from '../../layout/ScreenMessage.tsx'
import { appBaseUrl } from '../../lib/capture-tools.ts'
import { formatEventDate, plural, possessive } from '../../lib/format.ts'
import { ClaimSheet, type SheetRequest } from './ClaimSheet.tsx'
import { GiverItemCard, MyGiftLine } from './GiverItemCard.tsx'
import { actionErrorMessage, describeRow, itemHeadingId, OFFLINE_SAVED_NOTE, OWNER_HIDDEN_NOTE, requestItemId } from './giverText.ts'
import './GiverScreen.css'

function Banner({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="app-banner" role="status">
      {icon}
      <div className="app-banner__body">
        <p className="app-banner__title">{title}</p>
        {children}
      </div>
    </div>
  )
}

/** Moves focus to a wish card's heading, falling back to the list of wishes or the page heading. */
function focusItem(itemId: string | undefined): void {
  const target =
    (itemId ? document.getElementById(itemHeadingId(itemId)) : null) ??
    document.getElementById('giver-items') ??
    document.querySelector<HTMLElement>('h1')
  target?.focus({ preventScroll: false })
}

function claimRowFor(c: ClaimPayload): ClaimRow {
  return {
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
  }
}

/**
 * My gifts on wishes that are no longer on the list: either the owner took
 * them off, or stopped sharing the whole list (or replaced the link). Titles
 * come from the last version seen on this device.
 */
export function GiverRemovedSection({ view, onRequest }: { view: GiverListView; onRequest: (r: SheetRequest) => void }) {
  if (view.removedItemsWithMyClaims.length === 0) return null
  const stopped = view.status === 'unpublished'
  return (
    <section className="app-stack" aria-labelledby="giver-removed">
      <SectionHeader title={<span id="giver-removed">{stopped ? 'Your gifts from this list' : 'Taken off the list'}</span>} />
      <p className="app-note">
        {stopped
          ? 'The owner is no longer sharing this list, or has sent a new link. Here is what you promised.'
          : 'The owner took these off the list after you said you would get them or chip in.'}
      </p>
      <div className="giver-items">
        {view.removedItemsWithMyClaims.map((r) => {
          const title = r.title ?? (stopped ? 'A wish from this list' : 'A removed wish')
          const titleId = itemHeadingId(r.itemId)
          return (
            <article key={r.itemId} className="giver-item" aria-labelledby={titleId}>
              <div className="giver-item__main">
                <h3 id={titleId} className="giver-item__title" tabIndex={-1}>
                  {title}
                </h3>
                <StatusPill status="removed" label={stopped ? 'No longer shared' : 'Taken off'} />
              </div>
              <ul className="giver-item__lines" aria-label={`What you did for ${title}`}>
                {r.myClaims.map((c) => (
                  <MyGiftLine key={c.id} text={describeRow(claimRowFor(c))}>
                    <Button variant="ghost" size="md" aria-describedby={titleId} onClick={() => onRequest({ mode: 'withdraw', title, claimId: c.id, itemId: r.itemId })}>
                      Take back
                    </Button>
                  </MyGiftLine>
                ))}
              </ul>
            </article>
          )
        })}
      </div>
    </section>
  )
}

/**
 * First open of a shared list on this device: how it works in two lines, and an optional
 * nickname. Not a blocking step; shown once per device and dismissible.
 */
function GiverIntro({ session, ownerName, nickname, onDismiss }: { session: GiverListSession; ownerName: string | undefined; nickname: string | undefined; onDismiss: () => void }) {
  const notify = useNotify()
  const [name, setName] = useState(nickname ?? '')
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const owner = ownerName ?? 'the list owner'
  const save = async () => {
    if (saving) return
    const clean = name.replace(/\s+/g, ' ').trim()
    if ([...clean].length > LIMITS.nickname) {
      setError(`Use up to ${LIMITS.nickname} characters.`)
      return
    }
    setSaving(true)
    try {
      await session.setNickname(clean || undefined)
      notify(clean ? `Others with the link see you as ${clean}.` : 'You appear as Someone.')
      onDismiss()
    } catch {
      setError('Could not save the name. Please try again.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="giver-intro motion-enter" aria-labelledby="giver-intro-title">
      <div className="giver-intro__head">
        <h2 id="giver-intro-title" className="app-banner__title">
          How this works
        </h2>
        <IconButton variant="ghost" aria-label="Dismiss how this works" icon={<X />} onClick={onDismiss} />
      </div>
      <div className="giver-intro__text">
        <p>Pick a wish and say &ldquo;I&apos;ll get this&rdquo;, or chip in toward it.</p>
        <p>{`Hippo hides this from ${owner}, so it stays a surprise.`}</p>
      </div>
      <form
        className="giver-intro__form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <TextField
          label="Your name (optional)"
          value={name}
          maxLength={LIMITS.nickname * 2}
          autoComplete="nickname"
          onChange={(e) => {
            setName(e.target.value)
            setError(undefined)
          }}
          hint={`Others with the link see it next to what you pick. ${ownerName ?? 'The owner'} never does.`}
          {...(error ? { error } : {})}
        />
        <div>
          <Button type="submit" variant="ghost" size="md" loading={saving} className="giver-intro__save">
            Save name
          </Button>
        </div>
      </form>
    </section>
  )
}

/** Whether to show the giver intro: decided once, when settings first load, and recorded as shown. */
function useGiverIntro(): [boolean, () => void] {
  const core = useCore()
  const settings = useSettings()
  const [show, setShow] = useState<boolean | null>(null)
  if (show === null && settings) setShow(settings.seen.giverIntro === undefined)
  useEffect(() => {
    if (show) void markSeen(core.db, 'giverIntro', Date.now()).catch(() => undefined)
  }, [show, core])
  return [show === true, () => setShow(false)]
}

function InviteOthers({ topic, listName }: { topic: string; listName: string }) {
  const core = useCore()
  const notify = useNotify()
  const canShare = typeof navigator.share === 'function'

  const linkFor = async (): Promise<string | null> => {
    const guest = await getGuestList(core.db, topic)
    return guest ? buildGuestShareLink(guest, appBaseUrl()) : null
  }

  const copy = async () => {
    try {
      const link = await linkFor()
      if (!link) throw new Error('missing')
      await navigator.clipboard.writeText(link)
      notify('Link copied. Send it to family and friends who want to help.')
    } catch {
      notify('Copying did not work here. Ask the person who sent you the link to send it to others.')
    }
  }

  const share = async () => {
    try {
      const link = await linkFor()
      if (!link) throw new Error('missing')
      await navigator.share({ title: listName, url: link })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      notify('Sharing did not work here. Copy the link instead.')
    }
  }

  return (
    <section className="app-stack" aria-labelledby="giver-invite">
      <SectionHeader title={<span id="giver-invite">Invite others</span>} />
      <p className="app-note">Anyone with the link can see the list and who is getting what.</p>
      <div className="app-row app-row--fill">
        <Button variant="secondary" size="md" fullWidth icon={<Copy />} onClick={() => void copy()}>
          Copy link
        </Button>
        {canShare ? (
          <Button variant="secondary" size="md" fullWidth icon={<Share2 />} onClick={() => void share()}>
            Share link
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function GiverList({ session, view }: { session: GiverListSession; view: GiverListView }) {
  const core = useCore()
  const notify = useNotify()
  const [, navigate] = useLocation()
  const [request, setRequest] = useState<SheetRequest | null>(null)
  const [confirmForget, setConfirmForget] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const [marking, setMarking] = useState<string | null>(null)
  const [showIntro, dismissIntro] = useGiverIntro()
  // While a sheet covers the cards, they keep showing what was there; the change (dots filling,
  // a pill appearing) plays as the sheet leaves, where it can be seen.
  const [cardsView, setCardsView] = useState(view)
  if (!request && cardsView !== view) setCardsView(view)
  const cards = request ? cardsView : view
  const meta = view.meta
  const available = view.items.filter((v) => v.state.status === 'available' || v.state.status === 'partial').length
  const myActive = new Set<string>()
  for (const v of view.items) if (v.state.rows.some((r) => r.mine)) myActive.add(v.item.id)
  for (const r of view.removedItemsWithMyClaims) myActive.add(r.itemId)

  const focusAfter = useRef<{ itemId: string | undefined } | null>(null)
  const closeSheet = (succeeded: boolean) => {
    // The button that opened the sheet may be gone (for example "I'll get this" after getting it), so focus the wish itself.
    if (succeeded) focusAfter.current = { itemId: request ? requestItemId(request) : undefined }
    setRequest(null)
  }
  // Runs after the sheet has closed and returned focus (child effects run first), so this has the last word.
  useEffect(() => {
    if (request || !focusAfter.current) return
    focusItem(focusAfter.current.itemId)
    focusAfter.current = null
  }, [request])

  const markPurchased = async (row: ClaimRow, purchased: boolean) => {
    if (marking) return
    setMarking(row.claimId)
    try {
      const r = await session.markPurchased(row.claimId, purchased)
      notify(!r.result.ok ? OFFLINE_SAVED_NOTE : purchased ? 'Marked as bought.' : 'Marked as not bought yet.')
    } catch (e) {
      notify(actionErrorMessage(e))
    } finally {
      setMarking(null)
    }
  }

  const forget = async () => {
    if (forgetting) return
    setForgetting(true)
    try {
      await hideGuestList(core, view.topic)
      session.stop()
      setConfirmForget(false)
      notify('Removed from this device. Open the link again to bring it back.')
      navigate('/lists')
    } catch {
      setForgetting(false)
      notify('Could not remove the list. Please try again.')
    }
  }

  const title = meta?.name ?? (view.status === 'loading' ? 'Opening list…' : 'Shared list')
  const intro = meta ? (
    <>
      {meta.ownerName ? <p className="giver-owner">{`${possessive(meta.ownerName)} list`}</p> : null}
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
          <p>{meta ? 'Showing what was saved on this device. Hippo keeps trying and updates when it can.' : 'Check your connection. Hippo keeps trying while this page is open.'}</p>
        </Banner>
      ) : null}

      {showIntro && meta && view.status !== 'unpublished' ? (
        <GiverIntro
          session={session}
          ownerName={meta.ownerName}
          nickname={view.nickname}
          onDismiss={() => {
            dismissIntro()
            document.getElementById('giver-items')?.focus()
          }}
        />
      ) : null}

      {view.status === 'loading' && !meta ? (
        <div className="app-stack" aria-label="Loading the list">
          <Skeleton height={120} shape="tile" />
          <Skeleton height={120} shape="tile" />
        </div>
      ) : null}

      {view.status === 'live' && !meta ? (
        <EmptyState
          title={<TwoTone muted="Nothing here yet." bright="We could not find this list." />}
          description="It may not be shared yet, or the link was replaced with a new one. Ask the person who sent it for the latest link."
        />
      ) : null}

      {view.status === 'unpublished' ? (
        <EmptyState
          title={<TwoTone muted="Sharing stopped." bright="This list is no longer shared." />}
          description="The owner stopped sharing it or made a new link. If you still want to help, ask them for the new link."
        />
      ) : null}

      {meta && view.status !== 'unpublished' ? (
        <section className="app-stack" aria-labelledby="giver-items">
          <div className="app-row app-row--between">
            <h2 id="giver-items" className="app-section-title" tabIndex={-1}>
              Wishes
            </h2>
            <span className="app-note">{`${available} still open`}</span>
          </div>
          {view.items.length === 0 ? (
            <p className="app-note">There is nothing on this list yet. Check back later.</p>
          ) : (
            <div className="giver-items motion-reveal">
              {cards.items.map((v) => (
                <GiverItemCard
                  key={v.item.id}
                  view={v}
                  pendingClaimIds={cards.pendingClaimIds}
                  onRequest={setRequest}
                  onMarkPurchased={(row, p) => void markPurchased(row, p)}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <GiverRemovedSection view={view} onRequest={setRequest} />

      {meta && view.status !== 'unpublished' ? <InviteOthers topic={view.topic} listName={meta.name} /> : null}

      <section className="app-stack app-stack--tight" aria-label="About this list">
        <p className="app-note giver-privacy">
          <LockKeyhole aria-hidden="true" size={16} /> {OWNER_HIDDEN_NOTE}
        </p>
        <div>
          <Button variant="ghost" size="md" onClick={() => setConfirmForget(true)}>
            Remove from this device
          </Button>
        </div>
      </section>

      <ClaimSheet request={request} session={session} onClose={closeSheet} />
      <BottomSheet
        open={confirmForget}
        onClose={() => setConfirmForget(false)}
        title="Remove this list from this device?"
        description="It will no longer appear under Lists shared with me. To see it again, open the link you were sent. Hippo remembers you, so you can still change your gifts then."
      >
        <div className="app-stack">
          {myActive.size > 0 ? (
            <p className="app-note" role="note">
              {`You are getting or chipping in on ${plural(myActive.size, 'wish', 'wishes')} here. Removing the list does not take ${myActive.size === 1 ? 'it' : 'them'} back: others will still see ${myActive.size === 1 ? 'it' : 'them'} as taken care of. To take something back, do it before you remove the list, or open the link again later.`}
            </p>
          ) : null}
          <Button variant="danger" fullWidth loading={forgetting} onClick={() => void forget()}>
            Remove from this device
          </Button>
          <Button variant="secondary" fullWidth onClick={() => setConfirmForget(false)}>
            Keep it
          </Button>
        </div>
      </BottomSheet>
    </AppScreen>
  )
}

function GiverReady({ session }: { session: GiverListSession }) {
  const view = useGiverView(session)
  if (!view) return null
  return <GiverList session={session} view={view} />
}

function Opening() {
  return (
    <AppScreen title="Opening list…" compactTitle back="#/lists" backLabel="Lists" busy>
      <div className="app-stack">
        <Skeleton height={120} shape="tile" />
        <Skeleton height={120} shape="tile" />
      </div>
    </AppScreen>
  )
}

function Problem({ problem }: { problem: GiverProblem }) {
  if (problem.kind === 'own-list') {
    return (
      <AppScreen title="This is your own list" compactTitle back="#/lists" backLabel="Lists">
        <ScreenMessage
          actions={
            problem.listId ? (
              <LinkButton href={`#/list/${problem.listId}`} variant="primary">
                Open list settings
              </LinkButton>
            ) : (
              <LinkButton href="#/lists" variant="primary">
                Go to your lists
              </LinkButton>
            )
          }
        >
          <p>You made this list on this device, so Hippo will not show what friends are getting. That keeps your gifts a surprise.</p>
        </ScreenMessage>
      </AppScreen>
    )
  }

  if (problem.kind === 'invalid-link') {
    return (
      <AppScreen title="This link does not work" compactTitle back="#/" backLabel="Home">
        <ScreenMessage
          actions={
            <LinkButton href="#/" variant="secondary">
              Go to home
            </LinkButton>
          }
        >
          <p>Part of it may have been cut off when it was copied. Ask the person who sent it to send the whole link again.</p>
        </ScreenMessage>
      </AppScreen>
    )
  }

  return (
    <AppScreen title="List not available" compactTitle back="#/lists" backLabel="Lists">
      <ScreenMessage
        actions={
          <LinkButton href="#/lists" variant="secondary">
            Go to lists
          </LinkButton>
        }
      >
        <p>
          {problem.kind === 'not-found'
            ? 'It is no longer saved on this device. Open the link you were sent to add it again.'
            : 'Something went wrong while opening it. Reload the page to try again.'}
        </p>
      </ScreenMessage>
    </AppScreen>
  )
}

/**
 * `#/l/<payload>`: adds the list, then replaces this history entry with
 * `#/g/<topic>` so the link's secret leaves the address bar and history.
 */
export function GiverLinkScreen({ payload }: { payload: string }) {
  const state = useAddGuestLink(payload)
  const [, navigate] = useLocation()
  const done = useRef(false)
  useEffect(() => {
    if (state.kind !== 'added' || done.current) return
    done.current = true
    navigate(`/g/${state.topic}`, { replace: true })
  }, [state, navigate])
  if (state.kind === 'opening' || state.kind === 'added') return <Opening />
  return <Problem problem={state} />
}

/** `#/g/<topic>`: a remembered list shared with me. */
export function GiverScreen({ topic }: { topic: string }) {
  const state = useGiverSession(topic)
  if (state.kind === 'ready') return <GiverReady key={state.session.topic} session={state.session} />
  if (state.kind === 'opening') return <Opening />
  return <Problem problem={state} />
}
