import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, CloudOff, Copy, Link2Off, RefreshCw, Send, Share2, Trash2 } from 'lucide-react'
import { useLocation } from 'wouter'
import {
  BottomSheet,
  Button,
  Checkbox,
  EmptyState,
  LinkButton,
  SectionHeader,
  Skeleton,
  Switch,
  TextArea,
  TextField,
  TwoTone,
} from '../../../ui/index.ts'
import {
  buildShareLink,
  createSharedList,
  deleteSharedList,
  isHippoError,
  LIMITS,
  publishList,
  repairOwnerList,
  rotateList,
  syncList,
  unpublishList,
  updateSharedList,
  type Item,
  type SharedList,
  type SharedListPatch,
} from '../../../core/index.ts'
import { useCore } from '../../core/context.ts'
import { useItems, useSharedList } from '../../core/data.ts'
import { nudgeSyncRetry } from '../../core/core.ts'
import { useNotify } from '../../core/notify.ts'
import { requestPersistentStorage } from '../../core/storage.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { shareBaseUrl } from '../../lib/site-address.ts'
import { SiteReachNote } from '../../lib/SiteReach.tsx'
import { dismissSiteGuide, needsSiteSetup } from '../../lib/site-reach.ts'
import { canShareSheet, shareSheet } from '../../native/index.ts'
import { formatEventDate, plural, summariseSync, type SyncSummary } from '../../lib/format.ts'
import { SyncFeedback } from './SyncFeedback.tsx'
import './ListEditorScreen.css'

// The guided screen before a first share is for the Android app only; the website never loads it.
const SiteGuideSheet = __HIPPO_NATIVE__ ? lazy(() => import('./SiteGuideSheet.tsx')) : null

interface DetailsState {
  name: string
  eventDate: string
  message: string
}

type DetailsErrors = Partial<Record<keyof DetailsState, string>>

function validateDetails(d: DetailsState): DetailsErrors {
  const e: DetailsErrors = {}
  if (!d.name.trim()) e.name = 'Give the list a name, like "Birthday 2027".'
  if (d.eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(d.eventDate)) e.eventDate = 'Pick a date, or leave it empty.'
  return e
}

function DetailsFields({ value, onChange, errors }: { value: DetailsState; onChange: (v: DetailsState) => void; errors: DetailsErrors }) {
  return (
    <>
      <TextField
        label="List name"
        required
        aria-required="true"
        value={value.name}
        maxLength={LIMITS.name}
        placeholder="Birthday 2027"
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        {...(errors.name ? { error: errors.name } : {})}
      />
      <TextField
        label="Date (optional)"
        type="date"
        value={value.eventDate}
        onChange={(e) => onChange({ ...value, eventDate: e.target.value })}
        hint="Shown to friends. The list stays available after the date."
        {...(errors.eventDate ? { error: errors.eventDate } : {})}
      />
      <TextArea
        label="Message to friends (optional)"
        value={value.message}
        maxLength={LIMITS.message}
        rows={3}
        placeholder="Thank you for thinking of me!"
        onChange={(e) => onChange({ ...value, message: e.target.value })}
      />
    </>
  )
}

function ItemPicker({ items, selected, onToggle }: { items: Item[]; selected: readonly string[]; onToggle: (id: string, on: boolean) => void }) {
  if (items.length === 0) {
    return (
      <p className="app-note">
        Your wishlist is empty. <a className="app-text-link" href="#/item/new">Add a wish</a> first, then come back to put it on this list.
      </p>
    )
  }
  return (
    <ul className="list-picker">
      {items.map((item) => (
        <li key={item.id}>
          <Checkbox label={item.title} checked={selected.includes(item.id)} onChange={(e) => onToggle(item.id, e.target.checked)} />
        </li>
      ))}
    </ul>
  )
}

function NewListForm() {
  const core = useCore()
  const notify = useNotify()
  const [, navigate] = useLocation()
  const items = (useItems() ?? []).sort((a, b) => b.createdAt - a.createdAt)
  const [details, setDetails] = useState<DetailsState>({ name: '', eventDate: '', message: '' })
  const [errors, setErrors] = useState<DetailsErrors>({})
  const [picked, setPicked] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validateDetails(details)
    setErrors(errs)
    if (Object.keys(errs).length > 0) {
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.list-form [aria-invalid="true"]')?.focus())
      return
    }
    setSaving(true)
    try {
      const list = await createSharedList(core, {
        name: details.name.trim(),
        ...(details.message.trim() ? { message: details.message.trim() } : {}),
        ...(details.eventDate ? { eventDate: details.eventDate } : {}),
        itemIds: picked,
      })
      notify(`Created ${list.name}. Share it when you are ready.`)
      navigate(`/list/${list.id}`, { replace: true })
    } catch (err) {
      setSaving(false)
      setErrors({ name: isHippoError(err, 'invalid-input') ? 'Something here is too long.' : 'Could not create the list. Please try again.' })
    }
  }

  return (
    <form className="list-form app-stack app-stack--loose" onSubmit={(e) => void submit(e)} noValidate>
      <div className="app-stack">
        <DetailsFields value={details} onChange={setDetails} errors={errors} />
      </div>
      <fieldset className="list-fieldset">
        <legend className="app-section-title">What goes on it?</legend>
        <p className="app-note">{picked.length === 0 ? 'Choose wishes from your wishlist. You can change this later.' : `${plural(picked.length, 'wish', 'wishes')} chosen`}</p>
        <ItemPicker items={items} selected={picked} onToggle={(id, on) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)))} />
      </fieldset>
      <Button type="submit" variant="primary" fullWidth loading={saving}>
        Create list
      </Button>
    </form>
  )
}

function ShareLinkBox({ list, entering }: { list: SharedList; entering: boolean }) {
  const notify = useNotify()
  const link = buildShareLink(list, shareBaseUrl())
  const canShare = canShareSheet()
  const [copied, setCopied] = useState(0)
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(0), 2000)
    return () => window.clearTimeout(id)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied((n) => n + 1)
      notify('Link copied. Paste it into a message to your friends.')
    } catch {
      document.querySelector<HTMLInputElement>('#share-link')?.select()
      notify('Select the link and copy it.')
    }
  }

  const share = async () => {
    const outcome = await shareSheet({ title: list.name, text: `My wishlist: ${list.name}`, url: link })
    if (outcome === 'failed') notify('Sharing did not work here. Copy the link instead.')
  }

  return (
    // Just shared: the link rises into place, so it is clear where it came from.
    <div className={entering ? 'app-stack motion-enter' : 'app-stack'}>
      <TextField
        id="share-link"
        label="Share link"
        readOnly
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        hint="Anyone with this link can see the list, say they will get a wish or chip in. Send it only to people you trust."
        data-testid="share-link"
      />
      <SiteReachNote />
      <div className="app-row app-row--fill">
        <Button
          variant="primary"
          size="md"
          fullWidth
          icon={copied ? <Check key={copied} className="motion-enter" /> : <Copy />}
          onClick={() => void copy()}
          data-share-copy=""
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        {canShare ? (
          <Button variant="secondary" size="md" fullWidth icon={<Share2 />} onClick={() => void share()}>
            Share link
          </Button>
        ) : null}
      </div>
    </div>
  )
}

type Confirm = 'unpublish' | 'rotate' | 'delete' | null

function ListEditor({ list }: { list: SharedList }) {
  const core = useCore()
  const notify = useNotify()
  const [, navigate] = useLocation()
  const allItems = useItems(true)
  const stored: DetailsState = { name: list.name, eventDate: list.eventDate ?? '', message: list.message ?? '' }
  const [details, setDetails] = useState<DetailsState>(stored)
  // The details as this form loaded them: saving writes only what was changed here.
  const [detailsBase, setDetailsBase] = useState<DetailsState>(stored)
  // A field not touched here follows changes made elsewhere (another tab).
  const follow = (Object.keys(stored) as (keyof DetailsState)[]).filter((k) => stored[k] !== detailsBase[k] && details[k] === detailsBase[k])
  if (follow.length > 0) {
    const update = Object.fromEntries(follow.map((k) => [k, stored[k]])) as Partial<DetailsState>
    setDetails({ ...details, ...update })
    setDetailsBase({ ...detailsBase, ...update })
  }
  const [errors, setErrors] = useState<DetailsErrors>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [summary, setSummary] = useState<SyncSummary | null>(null)
  const [openedAs] = useState(() => (list.status === 'published' && !list.linkPending ? 'shared' : 'not-shared'))
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [guide, setGuide] = useState(false)

  // Repair once when the editor opens: republishes anything relays lost (owner events only).
  const repaired = useRef(false)
  useEffect(() => {
    if (repaired.current || list.status === 'draft') return
    repaired.current = true
    void repairOwnerList(core, list.id).catch(() => undefined)
  }, [core, list.id, list.status])

  const active = (allItems ?? []).filter((i) => i.archivedAt === undefined).sort((a, b) => b.createdAt - a.createdAt)
  const archivedOnList = (allItems ?? []).filter((i) => i.archivedAt !== undefined && list.itemIds.includes(i.id))
  const liveCount = list.itemIds.filter((id) => active.some((i) => i.id === id)).length
  const changedKeys = (Object.keys(details) as (keyof DetailsState)[]).filter((k) => details[k] !== detailsBase[k])
  const dirty = changedKeys.length > 0

  const run = async (label: string, fn: () => Promise<void>) => {
    if (busy !== null && busy !== 'update') return
    setBusy(label)
    try {
      await fn()
    } catch {
      notify('Something went wrong. Your change is saved on this device; try again in a moment.')
    } finally {
      setBusy(null)
    }
  }

  const change = (patch: SharedListPatch, message?: string) =>
    run('update', async () => {
      await updateSharedList(core, list.id, patch)
      if (list.status === 'published') {
        const r = await syncList(core, list.id)
        setSummary(summariseSync([r]))
        if (!r.ok) nudgeSyncRetry()
        notify(
          !r.ok
            ? `${message ?? 'Saved.'} Hippo will send it to friends when it can reach the sync servers.`
            : message
              ? `${message} Friends will see the update.`
              : 'Updated for friends.',
        )
      } else if (message) notify(message)
    })

  const saveDetails = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validateDetails(details)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    const patch: SharedListPatch = {}
    if (changedKeys.includes('name')) patch.name = details.name.trim()
    if (changedKeys.includes('message')) patch.message = details.message.trim() || null
    if (changedKeys.includes('eventDate')) patch.eventDate = details.eventDate || null
    const words: Record<keyof DetailsState, string> = { name: 'name', eventDate: 'date', message: 'message' }
    const elsewhere = changedKeys.filter((k) => stored[k] !== detailsBase[k]).map((k) => words[k])
    await change(
      patch,
      elsewhere.length > 0 ? `Details saved. The ${elsewhere.join(' and ')} had also been changed somewhere else; yours replaced it.` : 'Details saved.',
    )
    setDetailsBase(details)
  }

  // "Share list" disappears once the list is shared: move focus to what replaces it. The list may
  // show "Not shared yet" (with Try again) for a moment before the link, so focus follows until the
  // link's Copy button is there, unless the person has moved focus elsewhere.
  const focusShare = useRef(false)
  useEffect(() => {
    if (!focusShare.current || busy !== null || list.status !== 'published') return
    const id = window.requestAnimationFrame(() => {
      const active = document.activeElement
      const free = !active || active === document.body || active.hasAttribute('data-share-retry') || active.hasAttribute('data-share-copy')
      if (!free) {
        focusShare.current = false
        return
      }
      const target = document.querySelector<HTMLElement>(list.linkPending ? '[data-share-retry]' : '[data-share-copy]')
      target?.focus()
      if (!list.linkPending) focusShare.current = false
    })
    return () => window.cancelAnimationFrame(id)
  }, [busy, list.status, list.linkPending])

  const sharePublished = async (before = '') => {
    focusShare.current = true
    const r = await publishList(core, list.id)
    const s = summariseSync([r])
    setSummary(s)
    void requestPersistentStorage()
    if (!r.ok) nudgeSyncRetry()
    const text = r.ok ? 'Your list is shared. Copy the link and send it to friends.' : 'Not shared yet. Hippo keeps trying and shows the link once it works.'
    notify(before ? `${before} ${text}` : text)
  }

  // In the app, the first share checks that the site the link will open on answers; if it does not,
  // the guided screen comes first (never blocking: "Share anyway").
  const publish = () =>
    run('publish', async () => {
      if (SiteGuideSheet && (await needsSiteSetup())) {
        setGuide(true)
        return
      }
      await sharePublished()
    })

  const retryNow = () =>
    run('retry', async () => {
      const r = await syncList(core, list.id)
      setSummary(summariseSync([r]))
      if (r.ok) notify('Your list is shared. Copy the link and send it to friends.')
      else {
        nudgeSyncRetry()
        notify('Still could not reach the sync servers. Hippo keeps trying.')
      }
    })

  const unpublish = () =>
    run('unpublish', async () => {
      setConfirm(null)
      const r = await unpublishList(core, list.id)
      setSummary(summariseSync([r]))
      if (!r.ok) nudgeSyncRetry()
      notify(
        r.ok
          ? 'Sharing stopped. People with the link now see that the list is no longer shared.'
          : 'Sharing stopped on this device. Hippo will tell people with the link once it can reach the sync servers.',
      )
    })

  const rotate = () =>
    run('rotate', async () => {
      setConfirm(null)
      const r = await rotateList(core, list.id)
      setSummary(summariseSync([r.published, r.unpublishedOld]))
      if (!r.published.ok || !r.unpublishedOld.ok) nudgeSyncRetry()
      notify(
        r.published.ok && r.unpublishedOld.ok
          ? 'New link ready. The old link no longer works.'
          : 'New link made. Hippo is still sending it to the sync servers and keeps trying.',
      )
    })

  const remove = () =>
    run('delete', async () => {
      setConfirm(null)
      const r = await deleteSharedList(core, list.id)
      if (r && !r.ok) nudgeSyncRetry()
      notify(`Deleted ${list.name}. Your wishes are still in your wishlist.`)
      navigate('/lists')
    })

  const toggleItem = (id: string, on: boolean) => {
    const itemIds = on ? [...list.itemIds.filter((x) => x !== id), id] : list.itemIds.filter((x) => x !== id)
    const title = active.find((i) => i.id === id)?.title ?? 'Wish'
    void change({ itemIds }, on ? `${title} added to the list.` : `${title} taken off the list.`)
  }

  return (
    <div className="app-sheet list-editor">
      <section className="app-stack list-editor__share" aria-labelledby="share-title">
        <h2 id="share-title" className="app-section-title">
          Sharing
        </h2>
        {list.status === 'draft' ? (
          <>
            <p className="app-note">
              {liveCount === 0
                ? 'Not shared yet. Add some wishes below, then share. Friends get a private link and need no account.'
                : `Not shared yet. Friends get a private link to ${plural(liveCount, 'wish', 'wishes')} and need no account.`}
            </p>
            <Button variant="primary" fullWidth icon={<Send />} loading={busy === 'publish'} onClick={() => void publish()}>
              Share list
            </Button>
          </>
        ) : list.status === 'published' && list.linkPending ? (
          <>
            <div className="app-banner app-banner--warn" role="status">
              <CloudOff aria-hidden="true" />
              <div className="app-banner__body">
                <p className="app-banner__title">Not shared yet</p>
                <p>Hippo could not reach the sync servers, so the link would not work yet. It keeps trying in the background and shows the link here once it works.</p>
              </div>
            </div>
            <Button variant="secondary" fullWidth icon={<RefreshCw />} loading={busy === 'retry'} onClick={() => void retryNow()} data-share-retry="">
              Try again now
            </Button>
          </>
        ) : list.status === 'published' ? (
          <>
            <ShareLinkBox list={list} entering={openedAs === 'not-shared'} />
            {list.syncPending && busy === null ? (
              <p className="app-note" role="status">
                Some changes have not reached friends yet. Hippo keeps trying in the background.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="app-note">Sharing is stopped. People with the link see that this list is no longer shared.</p>
            <Button variant="primary" fullWidth icon={<Send />} loading={busy === 'publish'} onClick={() => void publish()}>
              Share again with the same link
            </Button>
          </>
        )}
        {busy === 'update' ? (
          <p className="app-note" role="status">
            Updating…
          </p>
        ) : null}
        {/* A "not sent yet" result goes away once the background retry has sent everything. */}
        {summary && !(summary.accepted === 0 && !summary.empty && !list.syncPending && !list.linkPending) ? <SyncFeedback summary={summary} /> : null}
        <p className="app-note">Hippo hides who is getting what from you, so your gifts stay a surprise.</p>
      </section>

      <form className="list-form app-stack" onSubmit={(e) => void saveDetails(e)} noValidate aria-labelledby="details-title">
        <h2 id="details-title" className="app-section-title">
          Details
        </h2>
        <DetailsFields value={details} onChange={setDetails} errors={errors} />
        <Button type="submit" variant="secondary" size="md" disabled={!dirty} loading={busy === 'update' && dirty}>
          Save details
        </Button>
      </form>

      <section className="app-stack" aria-labelledby="show-title">
        <h2 id="show-title" className="app-section-title">
          What friends see
        </h2>
        <Switch
          label="Show prices"
          description="Needed for chipping in."
          checked={list.showPrices}
          onChange={(e) => void change({ showPrices: e.target.checked }, e.target.checked ? 'Prices are shown.' : 'Prices are hidden.')}
        />
        <Switch
          label="Show notes"
          description="Your notes on each wish, like size or colour."
          checked={list.showNotes}
          onChange={(e) => void change({ showNotes: e.target.checked }, e.target.checked ? 'Notes are shown.' : 'Notes are hidden.')}
        />
      </section>

      <fieldset className="list-fieldset list-editor__wishes">
        <legend className="app-section-title">{`Wishes on this list (${liveCount})`}</legend>
        {allItems === undefined ? <Skeleton height={48} shape="tile" /> : <ItemPicker items={active} selected={list.itemIds} onToggle={toggleItem} />}
        {archivedOnList.length > 0 ? (
          <p className="app-note">{`${plural(archivedOnList.length, 'archived wish is', 'archived wishes are')} left off until you unarchive ${archivedOnList.length === 1 ? 'it' : 'them'}.`}</p>
        ) : null}
      </fieldset>

      <section className="app-stack" aria-labelledby="manage-title">
        <SectionHeader title={<span id="manage-title">Manage</span>} />
        {list.status === 'published' ? (
          <Button variant="secondary" fullWidth icon={<Link2Off />} onClick={() => setConfirm('unpublish')} loading={busy === 'unpublish'}>
            Stop sharing
          </Button>
        ) : null}
        {list.status !== 'draft' ? (
          <Button variant="secondary" fullWidth icon={<RefreshCw />} onClick={() => setConfirm('rotate')} loading={busy === 'rotate'}>
            Make a new link
          </Button>
        ) : null}
        <Button variant="danger" fullWidth icon={<Trash2 />} onClick={() => setConfirm('delete')} loading={busy === 'delete'}>
          Delete list
        </Button>
      </section>

      {guide && SiteGuideSheet ? (
        <Suspense fallback={null}>
          <SiteGuideSheet
            open={guide}
            onClose={() => setGuide(false)}
            onConnected={({ host }) => {
              setGuide(false)
              void run('publish', () => sharePublished(`Connected to ${host}.`))
            }}
            onShareAnyway={() => {
              dismissSiteGuide()
              setGuide(false)
              void run('publish', () => sharePublished())
            }}
          />
        </Suspense>
      ) : null}
      <BottomSheet
        open={confirm === 'unpublish'}
        onClose={() => setConfirm(null)}
        title="Stop sharing this list?"
        description="People with the link will see that the list is no longer shared. You can share it again later with the same link."
      >
        <div className="app-stack">
          <Button variant="danger" fullWidth onClick={() => void unpublish()}>
            Stop sharing
          </Button>
          <Button variant="secondary" fullWidth onClick={() => setConfirm(null)}>
            Keep sharing
          </Button>
        </div>
      </BottomSheet>
      <BottomSheet
        open={confirm === 'rotate'}
        onClose={() => setConfirm(null)}
        title="Make a new link?"
        description="The current link stops working. Anyone who has it will see that the list is no longer shared, and what friends said they would get or chip in on will not carry over to the new link. You will need to send the new link to everyone again."
      >
        <div className="app-stack">
          <Button variant="danger" fullWidth onClick={() => void rotate()}>
            Make a new link
          </Button>
          <Button variant="secondary" fullWidth onClick={() => setConfirm(null)}>
            Keep the current link
          </Button>
        </div>
      </BottomSheet>
      <BottomSheet
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title="Delete this list?"
        description="Sharing stops and the list is removed from this device. The wishes on it stay in your wishlist."
      >
        <div className="app-stack">
          <Button variant="danger" fullWidth onClick={() => void remove()}>
            Delete list
          </Button>
          <Button variant="secondary" fullWidth onClick={() => setConfirm(null)}>
            Keep it
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}

export function ListEditorScreen({ id }: { id?: string }) {
  const list = useSharedList(id)
  if (id === undefined) {
    return (
      <AppScreen area="lists" title="New list" back="#/lists" backLabel="Back to lists">
        <NewListForm />
      </AppScreen>
    )
  }
  return (
    <AppScreen
      area="lists"
      width="wide"
      title={list ? list.name : 'List'}
      compactTitle
      intro={list?.eventDate ? <p>{formatEventDate(list.eventDate)}</p> : null}
      back="#/lists"
      backLabel="Back to lists"
      busy={list === undefined}
    >
      {list === undefined ? (
        <Skeleton height={120} shape="tile" />
      ) : list === null ? (
        <EmptyState
          title={<TwoTone muted="Not found." bright="This list is not on this device." />}
          description="It may have been deleted, or it was made on another device."
          action={
            <LinkButton href="#/lists" variant="secondary">
              Go to lists
            </LinkButton>
          }
        />
      ) : (
        <ListEditor key={list.id} list={list} />
      )}
    </AppScreen>
  )
}

export default ListEditorScreen
