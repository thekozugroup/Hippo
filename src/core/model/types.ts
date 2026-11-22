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
