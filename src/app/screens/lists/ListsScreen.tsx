import { Inbox, ListPlus, Plus } from 'lucide-react'
import {
  EmptyState,
  IconLink,
  LinkButton,
  List,
  ListRow,
  SectionHeader,
  Skeleton,
  StatusPill,
  Thumb,
  TwoTone,
} from '../../../ui/index.ts'
import { useGuestLists, useItems, useSharedLists } from '../../core/data.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { formatEventDate, plural } from '../../lib/format.ts'
import { ListStatusPill } from './ListStatusPill.tsx'

export function ListsScreen() {
  const lists = useSharedLists()
  const guests = useGuestLists()
  const items = useItems()
  const live = new Set((items ?? []).map((i) => i.id))

  return (
    <AppScreen
      nav="lists"
      title="Lists"
      intro={<p>Lists you share, and lists friends have shared with you.</p>}
      actions={<IconLink href="#/list/new" variant="frost" aria-label="New list" icon={<Plus />} />}
      busy={lists === undefined || guests === undefined}
    >
      <section aria-labelledby="lists-mine" className="app-stack">
        <SectionHeader title={<span id="lists-mine">Your lists</span>} strong />
        {lists === undefined ? (
          <Skeleton height={64} shape="tile" />
        ) : lists.length === 0 ? (
          <EmptyState
            icon={<ListPlus />}
            title={<TwoTone muted="No lists yet." bright="Make one for your next occasion." />}
            description="Pick wishes for a birthday, a wedding or the holidays, then send the link. Friends see only what you put on the list."
            action={
              <LinkButton href="#/list/new" variant="primary" icon={<Plus />}>
                New list
              </LinkButton>
            }
          />
        ) : (
          <>
            <List>
              {lists.map((l) => {
                const count = l.itemIds.filter((id) => live.has(id)).length
                return (
                  <ListRow
                    key={l.id}
                    href={`#/list/${l.id}`}
                    leading={<Thumb name={l.name} size="sm" />}
                    title={l.name}
                    secondary={[plural(count, 'item', 'items'), l.eventDate ? formatEventDate(l.eventDate) : null].filter(Boolean).join(' · ')}
                    trailing={<ListStatusPill status={l.status} />}
                  />
                )
              })}
            </List>
            <div>
              <LinkButton href="#/list/new" variant="secondary" size="md" icon={<Plus />}>
                New list
              </LinkButton>
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="lists-guest" className="app-stack">
        <SectionHeader title={<span id="lists-guest">Shared with me</span>} strong />
        {guests === undefined ? (
          <Skeleton height={64} shape="tile" />
        ) : guests.length === 0 ? (
          <div className="app-banner">
            <Inbox aria-hidden="true" />
            <p>When someone sends you a Hippo link and you open it, the list is remembered here on this device.</p>
          </div>
        ) : (
          <List>
            {guests.map((g) => (
              <ListRow
                key={g.topic}
                href={`#/g/${g.topic}`}
                leading={<Thumb name={g.name ?? 'Shared list'} size="sm" shape="round" />}
                title={g.name ?? 'Shared list'}
                secondary={g.unpublished ? 'No longer shared' : g.eventDate ? formatEventDate(g.eventDate) : g.nickname ? `You appear as ${g.nickname}` : 'Open to see what is available'}
                trailing={g.unpublished ? <StatusPill status="removed" label="Closed" /> : undefined}
              />
            ))}
          </List>
        )}
      </section>
    </AppScreen>
  )
}
