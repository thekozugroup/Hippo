// Local data model and wire payloads, PROTOCOL.md sections 1 and 4.

export type Importance = 'nice' | 'want' | 'love'

export const IMPORTANCE_LEVELS: readonly Importance[] = ['nice', 'want', 'love']

/** Money in integer minor units plus an ISO 4217 code. */
export interface Money {
  amount: number
  currency: string
}

export interface Item {
  id: string
  title: string
  url?: string
  imageUrl?: string
  price?: Money
  quantity: number
  importance: Importance
  notes?: string
  categoryIds: string[]
  allowContributions: boolean
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export interface Category {
  id: string
  name: string
  emoji?: string
  order: number
}

export type SharedListStatus = 'draft' | 'published' | 'unpublished'

/** A list I own. */
export interface SharedList {
  id: string
  name: string
  message?: string
  eventDate?: string
  itemIds: string[]
  showPrices: boolean
  showNotes: boolean
  ownerSecretKey: string
  listSecret: string
  relays: string[]
  status: SharedListStatus
  createdAt: number
  updatedAt: number
  publishedAt?: number
  /**
   * True while the list's latest local state (published content, or the
   * cut-off after unpublishing) has not been accepted by any relay yet.
   * `retryPendingSync` retries it.
   */
  syncPending?: boolean
  /**
   * True from publishing (or rotating) until a relay first accepts the list
   * under its current link. While true the link does not work yet, so the UI
   * shows the list as not shared yet and does not offer the link.
   */
  linkPending?: boolean
}

/** A list shared with me. */
export interface GuestList {
  topic: string
  ownerPubkey: string
  listSecret: string
  relays: string[]
  guestSecretKey: string
  nickname?: string
  addedAt: number
  lastOpenedAt: number
  /**
   * Set when the giver removed the list from this device. The record (and so
   * the guest key and nickname) is kept so that opening the link again
   * restores the same identity and the giver's claims stay theirs.
   */
  hiddenAt?: number
  /** Last known titles of items I claimed (shared item id -> title), shown after the owner removes or stops sharing them. */
  claimTitles?: Record<string, string>
}

export interface ListMetaPayload {
  v: 1
  name: string
  message?: string
  eventDate?: string
  itemIds: string[]
  showPrices: boolean
  showNotes: boolean
  status: 'published' | 'unpublished'
  updatedAt: number
}

export interface ItemPayload {
  v: 1
  id: string
  title: string
  url?: string
  imageUrl?: string
  price?: Money
  quantity: number
  importance: Importance
  notes?: string
  allowContributions: boolean
  updatedAt: number
}

export type ClaimKind = 'full' | 'pledge'
export type ClaimStatus = 'reserved' | 'purchased' | 'withdrawn'

export interface ClaimPayload {
  v: 1
  id: string
  itemId: string
  kind: ClaimKind
  quantity?: number
  amount?: Money
  status: ClaimStatus
  nickname?: string
  createdAt: number
  updatedAt: number
}

/**
 * A list this device no longer owns under that topic: the old side of a
 * rotation, or a deleted list. Kept for good so the device never opens the
 * topic or owner key as a guest (FR-25). `pending` holds the old secrets
 * only until the old link has been cut off (unpublished meta and item
 * tombstones accepted by at least one relay).
 */
export interface RetiredList {
  topic: string
  ownerPubkey: string
  listId: string
  reason: 'rotated' | 'deleted'
  retiredAt: number
  pending?: RetiredListSecrets
}

export interface RetiredListSecrets {
  ownerSecretKey: string
  listSecret: string
  relays: string[]
  name: string
  /** Shared (derived) item ids whose slots need a tombstone. */
  itemIds: string[]
}
