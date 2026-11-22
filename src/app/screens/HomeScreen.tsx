import { Gift, ListChecks, Plus, Settings, Share2, Users } from 'lucide-react'
import {
  BigValue,
  EmptyState,
  IconLink,
  List,
  ListRow,
  LinkButton,
  MoneyText,
  SectionHeader,
  Skeleton,
  StatCard,
  StatusPill,
  Thumb,
  TwoTone,
} from '../../ui/index.ts'
import type { SharedList } from '../../core/index.ts'
import { useCore } from '../core/context.ts'
import { useGuestLists, useItems, useSettings, useSharedLists } from '../core/data.ts'
import { AppScreen } from '../layout/AppScreen.tsx'
import { formatAdded, formatEventDate, listStatusLabel, plural, safeUrl } from '../lib/format.ts'
import { BackupReminder } from './BackupReminder.tsx'
import './HomeScreen.css'

const GUESTS_SHOWN = 4

function listCaption(list: SharedList, live: number): string {
  return `${plural(live, 'wish', 'wishes')} · ${listStatusLabel(list)}`
}

function HowItWorks() {
  return (
    <section className="app-stack" aria-labelledby="how-title">
      <SectionHeader title={<span id="how-title">How Hippo works</span>} />
      <ol className="app-steps">
        <li>
          <span>
            <strong>Add wishes.</strong> Type them in, paste a shop link, or share a page to Hippo from your phone.
          </span>
        </li>
        <li>
          <span>
            <strong>Make a list for an occasion</strong> and pick which wishes go on it.
          </span>
        </li>
        <li>
          <span>
            <strong>Send the link</strong> to family and friends. They say &quot;I&apos;ll get this&quot; or chip in. Hippo hides who is getting what from you, so it stays a surprise.
          </span>
        </li>
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
  const recent = [...(items ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4)
  const liveIds = new Set((items ?? []).map((i) => i.id))
  const shareHref = lists && lists.length > 0 ? '#/lists' : '#/list/new'

  return (
    <AppScreen
      nav="home"
      busy={loading}
      title={
        count === 0 ? (
          <TwoTone tone="on-hero" muted="Your private gift wishlist," bright="ready to share with family and friends" />
        ) : (
          <TwoTone tone="on-hero" muted={`${plural(count, 'wish', 'wishes')} saved,`} bright="only on this device" />
        )
      }
      actions={<IconLink href="#/settings" variant="frost" aria-label="Settings" icon={<Settings />} />}
    >
      <section className="app-stack" aria-labelledby="home-wishlist">
        <div>
          <h2 id="home-wishlist" className="t-label t-muted">
            Wishlist
          </h2>
          {loading ? <Skeleton width={120} height={60} /> : <BigValue value={String(count)} secondary={count === 1 ? ' wish' : ' wishes'} />}
        </div>
        <div className="app-row app-row--nowrap">
          <LinkButton href="#/item/new" variant="primary" icon={<Plus />} fullWidth>
            Add
          </LinkButton>
          {count > 0 ? (
            <LinkButton href={shareHref} variant="secondary" icon={<Share2 />} fullWidth>
              Share
            </LinkButton>
          ) : null}
        </div>
      </section>

      {count > 0 || (lists?.length ?? 0) > 0 ? <BackupReminder lastExportAt={settings?.lastExportAt} /> : null}

      {!loading && count === 0 ? (
        <>
          <EmptyState
            className="home-empty"
            icon={<Gift />}
            title={<TwoTone muted="Nothing here yet." bright="Add the first thing you would love." />}
            description="Your wishlist is saved on this device only. Nobody sees it until you put wishes on a list and send the link."
          />
          <HowItWorks />
        </>
      ) : null}

      {recent.length > 0 ? (
        <section aria-labelledby="home-recent">
          <SectionHeader title={<span id="home-recent">Recent wishes</span>} strong action={{ label: 'See all', href: '#/wishlist' }} />
          <List>
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
        </section>
      ) : null}

      {lists && lists.length > 0 ? (
        <section aria-labelledby="home-lists">
          <SectionHeader title={<span id="home-lists">Your shared lists</span>} strong action={{ label: 'See all', href: '#/lists' }} />
          <ul className="app-grid-2 home-cards">
            {lists.slice(0, 4).map((list) => (
              <li key={list.id}>
                <a className="home-card" href={`#/list/${list.id}`}>
                  <StatCard
                    label={list.name}
                    action={<Users />}
                    value={<BigValue size="headline" value={String(list.itemIds.filter((id) => liveIds.has(id)).length)} />}
                    caption={listCaption(list, list.itemIds.filter((id) => liveIds.has(id)).length)}
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : count > 0 && lists ? (
        <section className="app-stack" aria-labelledby="home-nolists">
          <SectionHeader title={<span id="home-nolists">Shared lists</span>} strong />
          <p className="app-note">
            Ready to share? Make a list for a birthday or holiday, choose which wishes go on it, and send the link.
          </p>
          <div>
            <LinkButton href="#/list/new" variant="secondary" size="md" icon={<ListChecks />}>
              Make a list
            </LinkButton>
          </div>
        </section>
      ) : null}

      {guests && guests.length > 0 ? (
        <section aria-labelledby="home-guest">
          <SectionHeader
            title={<span id="home-guest">Lists shared with me</span>}
            strong
            {...(guests.length > GUESTS_SHOWN ? { action: { label: `See all ${guests.length}`, href: '#/lists' } } : {})}
          />
          <List>
            {guests.slice(0, GUESTS_SHOWN).map((g) => (
              <ListRow
                key={g.topic}
                href={`#/g/${g.topic}`}
                leading={<Thumb name={g.name ?? 'Shared list'} size="sm" shape="round" />}
                title={g.name ?? 'Shared list'}
                secondary={g.unpublished ? 'The owner stopped sharing it' : g.eventDate ? formatEventDate(g.eventDate) : 'Open to see what is still available'}
                trailing={g.unpublished ? <StatusPill status="draft" label="No longer shared" /> : undefined}
              />
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
