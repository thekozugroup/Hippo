import { ListRow, StatusPill, Thumb } from '../../../ui/index.ts'
import type { GuestListSummary, SharedList } from '../../../core/index.ts'
import { formatEventDate, listStatusLabel, plural } from '../../lib/format.ts'

/** A list I own. Shared is the normal state, so only "Not shared yet" and "Sharing stopped" get a pill. Never shows claim state (FR-17). */
export function OwnedListRow({ list, liveCount }: { list: SharedList; liveCount: number }) {
  const shared = list.status === 'published' && !list.linkPending
  return (
    <ListRow
      href={`#/list/${list.id}`}
      leading={<Thumb name={list.name} size="sm" />}
      title={list.name}
      secondary={[plural(liveCount, 'wish', 'wishes'), list.eventDate ? formatEventDate(list.eventDate) : null].filter(Boolean).join(' · ')}
      trailing={shared ? undefined : <StatusPill status="draft" label={listStatusLabel(list)} />}
    />
  )
}

/** A list someone shared with me. */
export function GuestListRow({ guest }: { guest: GuestListSummary }) {
  const name = guest.name ?? 'Shared list'
  const secondary = guest.eventDate ? formatEventDate(guest.eventDate) : guest.nickname ? `You appear as ${guest.nickname}` : undefined
  return (
    <ListRow
      href={`#/g/${guest.topic}`}
      leading={<Thumb name={name} size="sm" shape="round" />}
      title={name}
      {...(secondary ? { secondary } : {})}
      trailing={guest.unpublished ? <StatusPill status="removed" label="No longer shared" /> : undefined}
    />
  )
}
