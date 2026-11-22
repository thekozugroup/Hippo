import { StatusPill } from '../../../ui/index.ts'
import type { SharedList } from '../../../core/index.ts'
import { listStatusLabel } from '../../lib/format.ts'

/** Owner-side list status. Never shows claim state (FR-17). */
export function ListStatusPill({ list }: { list: Pick<SharedList, 'status' | 'linkPending'> }) {
  const label = listStatusLabel(list)
  if (list.status === 'published' && !list.linkPending) return <StatusPill status="published" label={label} />
  return <StatusPill status="draft" label={label} />
}
