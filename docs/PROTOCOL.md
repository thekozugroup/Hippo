# Hippo — Data Model and Sync Protocol (v1)

This document is the contract for `src/core/`. Everything here is framework-free TypeScript.

## 1. Local data model

All ids are 16 random bytes, lowercase hex. Timestamps are milliseconds since epoch unless stated. Money is an integer in minor units plus an ISO 4217 code.

```ts
type Importance = 'nice' | 'want' | 'love';

interface Money { amount: number; currency: string }   // amount in minor units

interface Item {
  id: string;
  title: string;
  url?: string;
  imageUrl?: string;
  price?: Money;
  quantity: number;              // >= 1
  importance: Importance;
  notes?: string;
  categoryIds: string[];
  allowContributions: boolean;   // givers may pledge partial amounts
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

interface Category { id: string; name: string; emoji?: string; order: number }

interface SharedList {                 // a list I own
  id: string;
  name: string;
  message?: string;
  eventDate?: string;                  // YYYY-MM-DD
  itemIds: string[];                   // ordered links into Item
  showPrices: boolean;
  showNotes: boolean;
  ownerSecretKey: string;              // hex, secp256k1, per list
  listSecret: string;                  // hex, 32 bytes
  relays: string[];
  status: 'draft' | 'published' | 'unpublished';
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
}

interface GuestList {                  // a list shared with me
  topic: string;                       // primary key
  ownerPubkey: string;
  listSecret: string;
  relays: string[];
  guestSecretKey: string;              // hex, secp256k1, per list per device
  nickname?: string;
  addedAt: number;
  lastOpenedAt: number;
}
```

A cache table stores the latest verified event per `(topic, d-tag)` so giver views work offline and can be re-broadcast.

## 2. Keys

Per shared list the owner generates:

- `ownerSecretKey`: random secp256k1 key. Its x-only public key is `ownerPubkey`. Signs all list content. Never leaves the owner's device.
- `listSecret`: 32 random bytes. Travels in the share link.

Derived with HKDF-SHA256, `ikm = listSecret`, `salt = "hippo/v1"`, 32-byte output, `info` as below:

| Name | info | Use |
|---|---|---|
| `contentKey` | `content` | AEAD key for list meta and items |
| `claimsKey` | `claims` | AEAD key for claims |
| `topic` | `topic` | hex string; opaque routing tag relays can index |

Each giver device generates `guestSecretKey` (random secp256k1) per list. It signs that giver's claims.

Encryption: XChaCha20-Poly1305 (`@noble/ciphers`). Payload is `base64(nonce(24) || ciphertext)`. Plaintext is UTF-8 JSON, padded before encryption to the next multiple of 256 bytes by appending spaces, so sizes leak less. Associated data is the event's `d` tag value, which binds a ciphertext to its slot.

## 3. Share link

```
https://<host><base>/#/l/<payload>
payload = base64url( 0x01 || ownerPubkey(32) || listSecret(32) )            // default relays
payload = base64url( 0x02 || ownerPubkey(32) || listSecret(32) || utf8(relays joined by ",") )
```

The payload is in the URL fragment, so it is never sent to the web host. Parsing must reject unknown versions and wrong lengths.

## 4. Events

All events are Nostr NIP-01 events of kind `30078` (NIP-78 application data, addressable by `pubkey + d`). Every event carries:

- `["d", <slot>]`
- `["t", <topic>]`
- `["expiration", <unix seconds>]` (NIP-40): event date + 180 days, or created + 400 days when there is no event date.

| Event | Author | `d` slot | Plaintext |
|---|---|---|---|
| List meta | owner | `hippo:<topic>:meta` | `ListMetaPayload` |
| Item | owner | `hippo:<topic>:item:<itemId>` | `ItemPayload` |
| Claim | giver | `hippo:<topic>:claim:<claimId>` | `ClaimPayload` |

```ts
interface ListMetaPayload {
  v: 1;
  name: string;
  message?: string;
  eventDate?: string;
  itemIds: string[];          // order; the set of live items
  showPrices: boolean;
  showNotes: boolean;
  status: 'published' | 'unpublished';
  movedTo?: string;           // new share link payload after rotation
  updatedAt: number;
}

interface ItemPayload {
  v: 1;
  id: string;
  title: string;
  url?: string;
  imageUrl?: string;
  price?: Money;              // omitted when showPrices is false
  quantity: number;
  importance: Importance;
  notes?: string;             // omitted when showNotes is false
  allowContributions: boolean;
  updatedAt: number;
}

interface ClaimPayload {
  v: 1;
  id: string;
  itemId: string;
  kind: 'full' | 'pledge';
  quantity?: number;          // kind 'full', default 1
  amount?: Money;             // kind 'pledge'
  status: 'reserved' | 'purchased' | 'withdrawn';
  nickname?: string;          // max 40 chars
  createdAt: number;          // first creation; kept across edits
  updatedAt: number;
}
```

The owner publishes meta and items encrypted with `contentKey`. Removing an item from a list removes its id from `itemIds`; the item event may be left to expire or replaced by an empty tombstone.

Givers publish claims encrypted with `claimsKey`. A claim is edited by publishing a replacement in the same slot. Withdrawing sets `status: 'withdrawn'`.

## 5. Validation (receiving side)

An event is accepted only if all of these hold:

1. Signature and id verify (`verifyEvent`).
2. Kind is 30078 and the `t` tag equals the list's `topic`.
3. The `d` slot has the expected prefix for this topic.
4. Meta and item events: `pubkey === ownerPubkey`. Anything else in those slots is dropped.
5. Claim events: any pubkey, but the slot's `claimId` must equal the decrypted `payload.id`, and a slot once seen from pubkey A is never overwritten by pubkey B (first author owns the slot; ties broken by lower `created_at`, then lower event id).
6. Decryption succeeds with the right key and AAD, and the payload passes schema validation (types, lengths, non-negative integers, known enums). Strings are length-limited: title 200, notes 2000, url 2000, nickname 40, name 100, message 1000.
7. For the same slot and author, the event with the higher `created_at` wins; ties broken by lower event id.

URLs from payloads are only rendered as links or images if their scheme is `http:` or `https:`.

## 6. Claim resolution

Pure function `resolveItemState(item, claims[])`, deterministic for all givers:

1. Ignore claims that are withdrawn or reference a different item.
2. Order by `payload.createdAt`, then by event id.
3. `pledged` = sum of `amount.amount` of pledge claims whose currency matches the item price currency. Pledges are only meaningful when the item has a price.
4. Full claims: walk in order, granting quantity while the granted total stays within `item.quantity`. Claims that do not fit are marked `conflict: true`.
5. State:
   - `claimed` when granted quantity equals `item.quantity`; `purchased` when all granted claims are purchased.
   - `funded` when `pledged >= price * quantity` (and at least one pledge).
   - `partial` when some quantity is granted or some amount is pledged.
   - `available` otherwise.
6. Output includes `remainingQuantity`, `pledged`, `remainingAmount`, per-claim rows (`mine`, `nickname`, `conflict`) for display.

## 7. Transport

```ts
interface Transport {
  publish(event: NostrEvent): Promise<PublishResult>;          // per-relay ok / error
  subscribe(filter: Filter, onEvent: (e: NostrEvent) => void, onEose?: () => void): Unsubscribe;
  fetch(filter: Filter, opts?: { timeoutMs?: number }): Promise<NostrEvent[]>;
  close(): void;
}
```

Implementations:

- `NostrTransport(relays)`: `nostr-tools` `SimplePool`. Publish succeeds if at least one relay accepts. Results list each relay.
- `MemoryTransport`: in-process, for tests and the offline demo. Honours addressable replacement and `#t`, `authors`, `kinds`, `#d` filters.

Owner filters: `{ kinds:[30078], authors:[ownerPubkey], '#t':[topic] }`.
Giver filters: `{ kinds:[30078], '#t':[topic] }` (owner events and all claims).
The owner app never subscribes without the `authors` restriction.

Default relays (config constant, overridable in settings): `wss://relay.primal.net`, `wss://relay.snort.social`, `wss://offchain.pub`, `wss://relay.nostr.net`, `wss://relay.damus.io`, `wss://nos.lol`.

## 8. Repair

Relays may drop events. On opening a list the client compares what the relays return with its local cache and republishes its own events that are missing: the owner republishes meta and items; a giver republishes their own claims. Clients may also republish other authors' cached, verified events unchanged (events are self-authenticating).

## 9. Rotation and unpublish

- Unpublish: publish meta with `status: 'unpublished'` and empty `itemIds`; publish empty tombstones for items.
- Rotate: create a new `listSecret` (and owner key), publish the list under the new topic, then publish old meta with `status: 'unpublished'` and no `movedTo` (rotation exists to cut off holders of the old link). Claims are not migrated.
