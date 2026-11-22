import { Plus } from 'lucide-react'
import { EmptyState, IconLink, LinkButton, List, SectionHeader, Skeleton, TwoTone } from '../../../ui/index.ts'
import { useGuestLists, useItems, useSharedLists } from '../../core/data.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { GuestListRow, OwnedListRow } from './ListRows.tsx'

export function ListsScreen() {
  const lists = useSharedLists()
  const guests = useGuestLists()
  const items = useItems()
  const live = new Set((items ?? []).map((i) => i.id))
  const hasLists = (lists?.length ?? 0) > 0

  return (
    <AppScreen
      nav="lists"
      title="Lists"
      // With no lists yet, the empty state below offers the same action, so the icon is left out.
      actions={hasLists ? <IconLink href="#/list/new" variant="frost" aria-label="Make a list" icon={<Plus />} /> : undefined}
      busy={lists === undefined || guests === undefined}
    >
      <section aria-labelledby="lists-mine" className="app-stack">
        <SectionHeader title={<span id="lists-mine">Your lists</span>} />
        {lists === undefined ? (
          <Skeleton height={64} shape="tile" />
        ) : lists.length === 0 ? (
          <EmptyState
            title={<TwoTone muted="No lists yet." bright="Make one for your next occasion." />}
            description="Pick wishes for a birthday, a wedding or the holidays, then send the link. Friends see only what you put on the list."
            action={
              <LinkButton href="#/list/new" variant="primary" icon={<Plus />}>
                Make a list
              </LinkButton>
            }
          />
        ) : (
          <List>
            {lists.map((l) => (
              <OwnedListRow key={l.id} list={l} liveCount={l.itemIds.filter((id) => live.has(id)).length} />
            ))}
          </List>
        )}
      </section>

      <section aria-labelledby="lists-guest" className="app-stack">
        <SectionHeader title={<span id="lists-guest">Shared with me</span>} />
        {guests === undefined ? (
          <Skeleton height={64} shape="tile" />
        ) : guests.length === 0 ? (
          <p className="app-note">Lists friends send you appear here once you open their link on this device.</p>
        ) : (
          <List>
            {guests.map((g) => (
              <GuestListRow key={g.topic} guest={g} />
            ))}
          </List>
        )}
      </section>
    </AppScreen>
  )
}
