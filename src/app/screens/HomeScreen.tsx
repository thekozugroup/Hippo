import { Plus, Share2 } from 'lucide-react'
import { BigValue, LinkButton, List, ListRow, MoneyText, SectionHeader, Skeleton, Thumb, TwoTone } from '../../ui/index.ts'
import { useCore } from '../core/context.ts'
import { useGuestLists, useItems, useSettings, useSharedLists } from '../core/data.ts'
import { AppScreen } from '../layout/AppScreen.tsx'
import { setupChecklist } from '../core/onboarding.ts'
import { formatAdded, safeUrl } from '../lib/format.ts'
import { BackupReminder } from './BackupReminder.tsx'
import { GuestListRow, OwnedListRow } from './lists/ListRows.tsx'
import { SetupChecklist } from './SetupChecklist.tsx'

const RECENT_SHOWN = 4
const LISTS_SHOWN = 3

/** First run: what Hippo does in three short steps. */
function HowItWorks() {
  return (
    <section className="app-stack app-stack--tight" aria-labelledby="how-title">
      <SectionHeader title={<span id="how-title">How it works</span>} />
      <ol className="app-steps">
        <li>Add things you would love. Your wishlist stays on this device.</li>
        <li>Put some on a list for an occasion and send the link.</li>
        <li>Friends say &quot;I&apos;ll get this&quot; or chip in. Hippo hides who is getting what from you.</li>
      </ol>
    </section>
  )
}

export function HomeScreen() {
  const core = useCore()
  const items = useItems()
  const lists = useSharedLists()
  const guests = useGuestLists()
  const settings = useSettings()
  const loading = items === undefined || lists === undefined || guests === undefined
  const count = items?.length ?? 0
  const empty = !loading && count === 0
  const recent = [...(items ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, RECENT_SHOWN)
  const liveIds = new Set((items ?? []).map((i) => i.id))
  const shareHref = lists && lists.length > 0 ? '#/lists' : '#/list/new'
  const checklist =
    !loading && settings
      ? setupChecklist({
          stored: settings.onboarding,
          hiddenAt: settings.seen.setupChecklist,
          wishes: count,
          sharedLists: (lists ?? []).filter((l) => l.status === 'published').length,
          lastExportAt: settings.lastExportAt,
        })
      : null

  return (
    <AppScreen
      nav="home"
      busy={loading}
      title={
        empty ? (
          <TwoTone tone="on-hero" muted="Make a wishlist," bright="share it with family and friends" />
        ) : (
          <TwoTone tone="on-hero" muted="Your wishlist," bright="kept only on this device" />
        )
      }
    >
      <section className="app-stack" aria-labelledby="home-wishlist">
        {empty ? (
          <h2 id="home-wishlist" className="sr-only">
            Wishlist
          </h2>
        ) : (
          <div>
            <SectionHeader title={<span id="home-wishlist">Wishlist</span>} action={{ label: 'See all', href: '#/wishlist' }} />
            {loading ? <Skeleton width={120} height={60} /> : <BigValue className="motion-reveal" value={String(count)} secondary={count === 1 ? ' wish' : ' wishes'} />}
          </div>
        )}
        <div className="app-row app-row--fill">
          <LinkButton href="#/item/new" variant="primary" icon={<Plus />} fullWidth>
            Add a wish
          </LinkButton>
          {count > 0 ? (
            <LinkButton href={shareHref} variant="secondary" icon={<Share2 />} fullWidth>
              Share a list
            </LinkButton>
          ) : null}
        </div>
        {recent.length > 0 ? (
          <List aria-label="Recent wishes">
            {recent.map((item) => (
              <ListRow
                key={item.id}
                href={`#/item/${item.id}`}
                leading={<Thumb name={item.title} src={safeUrl(item.imageUrl)} size="sm" />}
                title={item.title}
                secondary={`Added ${formatAdded(item.createdAt)}`}
                trailing={item.price ? <MoneyText money={item.price} /> : undefined}
              />
            ))}
          </List>
        ) : null}
      </section>

      {checklist ? <SetupChecklist tasks={checklist} wishes={count} lists={lists ?? []} /> : empty ? <HowItWorks /> : null}

      {!checklist && (count > 0 || (lists?.length ?? 0) > 0) ? <BackupReminder lastExportAt={settings?.lastExportAt} /> : null}

      {lists && lists.length > 0 ? (
        <section aria-labelledby="home-lists">
          <SectionHeader
            title={<span id="home-lists">Your lists</span>}
            {...(lists.length > LISTS_SHOWN ? { action: { label: 'See all', href: '#/lists' } } : {})}
          />
          <List>
            {lists.slice(0, LISTS_SHOWN).map((list) => (
              <OwnedListRow key={list.id} list={list} liveCount={list.itemIds.filter((id) => liveIds.has(id)).length} />
            ))}
          </List>
        </section>
      ) : null}

      {guests && guests.length > 0 ? (
        <section aria-labelledby="home-guest">
          <SectionHeader
            title={<span id="home-guest">Shared with me</span>}
            {...(guests.length > LISTS_SHOWN ? { action: { label: 'See all', href: '#/lists' } } : {})}
          />
          <List>
            {guests.slice(0, LISTS_SHOWN).map((g) => (
              <GuestListRow key={g.topic} guest={g} />
            ))}
          </List>
        </section>
      ) : null}

      {core.forcedRelays ? (
        <p className="app-note" role="note">
          Test mode: sharing uses a local test server only.
        </p>
      ) : null}
    </AppScreen>
  )
}
