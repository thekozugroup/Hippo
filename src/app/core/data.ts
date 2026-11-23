// Live queries over the local database. Each hook returns `undefined` while
// the first result is loading; single-record hooks return `null` when the
// record does not exist.

import { useLiveQuery } from 'dexie-react-hooks'
import {
  getItem,
  getLinkPreviewEnabled,
  getPageLookupEnabled,
  getSettings,
  getSharedList,
  listCategories,
  listGuestLists,
  listItems,
  listSharedLists,
  type Category,
  type GuestListSummary,
  type Item,
  type Settings,
  type SharedList,
} from '../../core/index.ts'
import { useCore } from './context.ts'

export function useItems(includeArchived = false): Item[] | undefined {
  const { db } = useCore()
  return useLiveQuery(() => listItems(db, { includeArchived }), [db, includeArchived])
}

export function useItem(id: string | undefined): Item | null | undefined {
  const { db } = useCore()
  return useLiveQuery(async () => (id ? ((await getItem(db, id)) ?? null) : null), [db, id])
}

export function useCategories(): Category[] | undefined {
  const { db } = useCore()
  return useLiveQuery(() => listCategories(db), [db])
}

export function useSharedLists(): SharedList[] | undefined {
  const { db } = useCore()
  return useLiveQuery(() => listSharedLists(db), [db])
}

export function useSharedList(id: string | undefined): SharedList | null | undefined {
  const { db } = useCore()
  return useLiveQuery(async () => (id ? ((await getSharedList(db, id)) ?? null) : null), [db, id])
}

export function useGuestLists(): GuestListSummary[] | undefined {
  const { db } = useCore()
  return useLiveQuery(() => listGuestLists(db), [db])
}

export function useSettings(): Settings | undefined {
  const { db } = useCore()
  return useLiveQuery(() => getSettings(db), [db])
}

/** The opt-in for link lookups (off by default); `undefined` while it loads. */
export function useLinkPreviewEnabled(): boolean | undefined {
  const { db } = useCore()
  return useLiveQuery(() => getLinkPreviewEnabled(db), [db])
}

/** The Android app's "Read shop pages" setting (on unless turned off). */
export function usePageLookupEnabled(): boolean | undefined {
  const { db } = useCore()
  return useLiveQuery(() => getPageLookupEnabled(db), [db])
}
