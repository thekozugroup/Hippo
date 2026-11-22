import { StatusPill } from '../../../ui/index.ts'
import type { SharedListStatus } from '../../../core/index.ts'

/** Owner-side list status. Never shows claim state (FR-17). */
export function ListStatusPill({ status }: { status: SharedListStatus }) {
  if (status === 'published') return <StatusPill status="published" label="Shared" />
  if (status === 'draft') return <StatusPill status="draft" label="Not shared" />
  return <StatusPill status="removed" label="Stopped" />
}
