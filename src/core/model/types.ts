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
  movedTo?: string
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
