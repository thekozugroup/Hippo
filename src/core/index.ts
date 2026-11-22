// Public API of the framework-free core. See README.md for a one-line summary of each export.

export type * from './model/types.ts'
export { IMPORTANCE_LEVELS } from './model/types.ts'
export { LIMITS } from './model/limits.ts'
export { isSafeHttpUrl } from './model/guards.ts'
export { HippoError, isHippoError, type HippoErrorCode } from './errors.ts'
export { DEFAULT_RELAYS, RELAY_FORCE_QUERY_PARAM, RELAY_FORCE_STORAGE_KEY } from './config.ts'

export { createCore, applyRelayOverrideFromUrl, type Core, type CreateCoreOptions } from './context.ts'
export type { CoreDeps } from './services/deps.ts'

export { HippoDb, openDb, DB_NAME, type CachedEvent } from './db/schema.ts'
export { getSettings, setRelayOverride, setTheme, type Settings, type Theme } from './db/settings.ts'

export {
  createItem,
  updateItem,
  archiveItem,
  unarchiveItem,
  deleteItem,
  getItem,
  listItems,
  filterAndSortItems,
  listCategories,
  createCategory,
  updateCategory,
  reorderCategories,
  deleteCategory,
  type ItemInput,
  type ItemPatch,
  type ItemQuery,
  type ItemSort,
} from './services/wishlist.ts'

export {
  draftFromCapture,
  captureFromSearchParams,
  findFirstHttpUrl,
  guessTitleFromUrl,
  parsePrice,
  currencyDigits,
  type CaptureInput,
  type DraftItem,
} from './services/capture.ts'

export {
  createSharedList,
  updateSharedList,
  getSharedList,
  listSharedLists,
  findListsContainingItem,
  publishList,
  syncList,
  syncListsForItem,
  unpublishList,
  rotateList,
  deleteSharedList,
  repairOwnerList,
  buildShareLink,
  topicOfList,
  type SharedListInput,
  type SharedListPatch,
  type SyncReport,
  type PublishedEventReport,
} from './services/owner-lists.ts'

export {
  addGuestListFromLink,
  listGuestLists,
  removeGuestList,
  openGuestList,
  GiverListSession,
  type GiverListView,
  type GiverItemView,
  type GiverListStatus,
  type RemovedItemView,
  type GuestListSummary,
  type ClaimActionResult,
  type GiverSessionOptions,
} from './services/giver-lists.ts'

export { exportData, importData, parseExportFile, type ExportFile, type ImportResult } from './services/backup.ts'

export { resolveItemState, type ItemState, type ItemStatus, type ClaimRow, type ResolveClaim } from './protocol/resolve.ts'
export { parseShareLink, type SharePayload } from './crypto/link.ts'

export type { Transport, TransportProvider, PublishResult, RelayResult, EoseInfo, Unsubscribe } from './transport/types.ts'
export { staticTransport } from './transport/types.ts'
export { MemoryTransport, MemoryNetwork } from './transport/memory.ts'
export { NostrTransport, createNostrTransportProvider } from './transport/nostr.ts'
