// Public API of the framework-free core. See README.md for a one-line summary of each export.

export type * from './model/types.ts'
export { IMPORTANCE_LEVELS } from './model/types.ts'
export { LIMITS } from './model/limits.ts'
export { isSafeHttpUrl } from './model/guards.ts'
export { HippoError, isHippoError, type HippoErrorCode } from './errors.ts'
export { DEFAULT_RELAYS, RELAY_FORCE_QUERY_PARAM, RELAY_FORCE_STORAGE_KEY } from './config.ts'

export { isRelayUrl } from './model/validate.ts'
export { createCore, applyRelayOverrideFromUrl, readRelayOverride, type Core, type CreateCoreOptions } from './context.ts'
export type { CoreDeps } from './services/deps.ts'
export {
  TimeSync,
  systemClock,
  systemNow,
  fixedOffsetClock,
  offsetFromSample,
  describeClockOffset,
  CLOCK_WARN_MS,
  CLOCK_STORAGE_KEY,
  type Clock,
  type DateSample,
  type TimeSyncOptions,
} from './clock.ts'

export { HippoDb, openDb, DB_NAME, type CachedEvent } from './db/schema.ts'
export {
  getSettings,
  setRelayOverride,
  setTheme,
  setOwnerName,
  setOnboarding,
  markSeen,
  type Settings,
  type Theme,
  type OnboardingState,
  type SeenFlag,
} from './db/settings.ts'

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
  stripTrackingParams,
  isTrackingParam,
  TRACKING_PARAMS,
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
  repairRetiredLists,
  retryPendingSync,
  hasPendingSync,
  listRetiredLists,
  buildShareLink,
  topicOfList,
  sharedItemIdFor,
  localItemIdFor,
  type SharedListInput,
  type SharedListPatch,
  type SyncReport,
  type PublishedEventReport,
  type RetryReport,
} from './services/owner-lists.ts'

export {
  addGuestListFromLink,
  listGuestLists,
  getGuestList,
  hideGuestList,
  openGuestList,
  buildGuestShareLink,
  GiverListSession,
  type GiverListView,
  type GiverItemView,
  type GiverListStatus,
  type RemovedItemView,
  type GuestListSummary,
  type ClaimActionResult,
  type ClaimOutcome,
  type GiverSessionOptions,
} from './services/giver-lists.ts'

export { exportData, importData, parseExportFile, type ExportFile, type ImportResult } from './services/backup.ts'

export { resolveItemState, effectiveClaimTime, type ItemState, type ItemStatus, type ClaimRow, type ResolveClaim } from './protocol/resolve.ts'
export { parseShareLink, type SharePayload } from './crypto/link.ts'

export type { Transport, TransportProvider, PublishResult, RelayResult, EoseInfo, Unsubscribe } from './transport/types.ts'
export { staticTransport } from './transport/types.ts'
export { MemoryTransport, MemoryNetwork } from './transport/memory.ts'
export { NostrTransport, createNostrTransportProvider } from './transport/nostr.ts'

export { isFramed, blockIfFramed, FRAME_BLOCK_MESSAGE, FRAME_BLOCK_LINK_TEXT, type FrameWindowLike } from './services/frame-guard.ts'
export {
  checkDeployment,
  browserDeploymentEnv,
  type DeploymentCheck,
  type DeploymentCheckId,
  type DeploymentEnv,
  type CheckStatus,
  type ProbeSocket,
} from './services/deployment.ts'
export {
  lookupLinkPreview,
  fillEmptyFields,
  getLinkPreviewEnabled,
  setLinkPreviewEnabled,
  LINK_PREVIEW_SETTING_KEY,
  LINK_PREVIEW_HOST,
  LINK_PREVIEW_SERVICE_NAME,
  LINK_PREVIEW_DISCLOSURE,
  type LinkPreviewResult,
  type LinkPreviewPatch,
  type LinkPreviewFailure,
  type LinkPreviewDeps,
  type LinkPreviewCurrent,
} from './services/link-preview.ts'
