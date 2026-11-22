# Hippo — Data Model and Sync Protocol (v1)

This document is the contract for `src/core/`. Everything here is framework-free TypeScript.

## 1. Local data model

All ids are 16 random bytes, lowercase hex. Timestamps are milliseconds since epoch unless stated. Money is an integer in minor units plus an ISO 4217 code.

```ts
type Importance = 'nice' | 'want' | 'love';

interface Money { amount: number; currency: string }   // amount in minor units

interface Item {
  id: string;                    // local only; never sent (see section 2)
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
  itemIds: string[];                   // ordered links into Item (local ids)
  showPrices: boolean;
  showNotes: boolean;
  ownerSecretKey: string;              // hex, secp256k1, per list
  listSecret: string;                  // hex, 32 bytes
  relays: string[];
  status: 'draft' | 'published' | 'unpublished';
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  syncPending?: boolean;               // latest local state not yet accepted by any relay (section 8)
  linkPending?: boolean;               // current link never accepted by any relay: not shared yet
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
  hiddenAt?: number;                   // removed from this device's list; key kept (section 10)
  claimTitles?: Record<string, string>; // shared item id -> last title seen, for items I claimed
}

interface RetiredList {                // a topic this device no longer owns (rotation or deletion)
  topic: string;                       // primary key
  ownerPubkey: string;
  listId: string;
  reason: 'rotated' | 'deleted';
  retiredAt: number;
  pending?: {                          // only until the old link is cut off (section 9)
    ownerSecretKey: string;
    listSecret: string;
    relays: string[];
    name: string;
    itemIds: string[];                 // shared item ids to tombstone
  };
}
```

A cache table stores the latest verified event per `(topic, d-tag)` so giver views work offline and can be re-broadcast. A row may be marked `pending` (my event, no relay accepted it yet) and, for claims, `unsent` (no relay has ever accepted this claim's slot). Retired lists are kept for good, without secrets once cut off, so the device never opens them as a guest (section 10).

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
| `slotKey` | `slot` | owner only: maps local item ids to shared item ids |

Shared item id: `hex(HMAC-SHA256(slotKey, localItemId bytes)[0..16])`. It is the item's only id in the shared space: in its `d` slot, `ItemPayload.id`, `ListMetaPayload.itemIds` and `ClaimPayload.itemId`. The same wish in two lists, or before and after a rotation, has unrelated ids. The owner maps back by recomputing it for the list's local item ids. Nothing else in a tag repeats across lists: claim ids are random, owner keys are per list, guest keys are per list per device.

Each giver device generates `guestSecretKey` (random secp256k1) per list. It signs that giver's claims.

Encryption: XChaCha20-Poly1305 (`@noble/ciphers`) with a random 24-byte nonce. Payload is `base64(nonce(24) || ciphertext)`. Plaintext is UTF-8 JSON, padded before encryption to the next multiple of 256 bytes (at least 256) by appending spaces, so sizes leak less. Associated data is the event's `d` tag value, which binds a ciphertext to its slot. Content longer than 65,536 base64 characters is rejected.

## 3. Share link

```
https://<host><base>/#/l/<payload>
payload = base64url( 0x01 || ownerPubkey(32) || listSecret(32) )            // default relays
payload = base64url( 0x02 || ownerPubkey(32) || listSecret(32) || utf8(relays joined by ",") )
```

The payload is in the URL fragment, so it is never sent to the web host. Parsing must reject unknown versions, wrong lengths, non-canonical base64url, payloads over 4,096 characters, an `ownerPubkey` that is not a curve point, and a v2 relay list that is empty, has more than 20 entries, or has any entry that is not a public relay URL.

A public relay URL is `wss://` with no credentials or fragment, at most 200 characters, and a public hostname: not an IP literal in a loopback, private, carrier-grade NAT, link-local, benchmarking, multicast or reserved range (IPv6: only `2000::/3`), not `localhost`, and not a single-label name or one ending in `.localhost`, `.local`, `.localdomain`, `.internal`, `.intranet`, `.lan` or `.home.arpa`. The same rule applies to list relays, the relay setting and backups. `ws://` and loopback relays are allowed only through the developer override (section 7).

## 4. Events

All events are Nostr NIP-01 events of kind `30078` (NIP-78 application data, addressable by `pubkey + d`). Every event carries exactly these tags:

- `["d", <slot>]`
- `["t", <topic>]`
- `["expiration", <unix seconds>]` (NIP-40): `created_at` + 400 days, rounded up to 00:00 UTC on the first of the next month, plus 0 to 30 random whole days. It does not depend on the event date or anything else in the list.

| Event | Author | `d` slot | Plaintext |
|---|---|---|---|
| List meta | owner | `hippo:<topic>:meta` | `ListMetaPayload` |
| Item | owner | `hippo:<topic>:item:<sharedItemId>` | `ItemPayload` |
| Claim | giver | `hippo:<topic>:claim:<claimId>` | `ClaimPayload` |

```ts
interface ListMetaPayload {
  v: 1;
  name: string;
  message?: string;
  eventDate?: string;
  ownerName?: string;         // the owner's first name or nickname, max 40 chars; shown to givers
  itemIds: string[];          // shared item ids, in order; the set of live items
  showPrices: boolean;
  showNotes: boolean;
  status: 'published' | 'unpublished';
  updatedAt: number;
}

interface ItemPayload {
  v: 1;
  id: string;                 // shared item id
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
  itemId: string;             // shared item id
  kind: 'full' | 'pledge';
  quantity?: number;          // kind 'full', default 1
  amount?: Money;             // kind 'pledge'
  status: 'reserved' | 'purchased' | 'withdrawn';
  nickname?: string;          // max 40 chars
  createdAt: number;          // when the claim first reached a relay; kept across edits
  updatedAt: number;
}
```

Unknown payload fields are dropped by validation.

The owner publishes meta and items encrypted with `contentKey`. Removing an item from a list removes its id from `itemIds`; the item event is left to expire (section 10).

Givers publish claims encrypted with `claimsKey`. A claim is edited by publishing a replacement in the same slot. Withdrawing sets `status: 'withdrawn'`.

## 5. Validation (receiving side)

An event is accepted only if all of these hold:

1. Its fields have NIP-01 shapes (at most 16 tags, at most 8 values each, values at most 512 characters), the signature and id verify (`verifyEvent`), and the event is copied into a fresh object first.
2. Kind is 30078 and there is exactly one `t` tag, equal to the list's `topic`.
3. There is exactly one `d` tag, and its slot has the expected shape for this topic.
4. At most one `expiration` tag, and the event has not expired (judged by the corrected clock).
5. Meta and item events: `pubkey === ownerPubkey`. Anything else in those slots is dropped.
6. Claim events: any pubkey, but the slot's `claimId` must equal the decrypted `payload.id`; `created_at`, `payload.createdAt` and `payload.updatedAt` may not be more than 10 minutes in the future of the receiving device's corrected clock (section 10, note 13); and a slot once seen from pubkey A is never overwritten by pubkey B (first author owns the slot; ties broken by lower `created_at`, then lower event id). At most 5,000 claim slots are kept per list; new slots beyond that are ignored.
7. Decryption succeeds with the right key and AAD, and the payload passes schema validation (types, lengths, non-negative integers, known enums, ids are 16 bytes hex). Strings are length-limited in code points: title 200, notes 2000, url 2000, nickname 40, ownerName 40, name 100, message 1000. Quantities are 1 to 9,999; money is at most 10^11 minor units. An item event with empty content is an owner tombstone.
8. For the same slot and author, the event with the higher `created_at` wins; ties broken by lower event id.

URLs from payloads that are not `http:` or `https:` are dropped during validation, and are only rendered as links or images if their scheme is `http:` or `https:`. Expired events are also removed from the local cache when a list is opened.

## 6. Claim resolution

Pure function `resolveItemState(item, claims[])`, deterministic for all givers who hold the same claims:

1. Ignore claims that are withdrawn or reference a different item.
2. A claim's effective time is `min(payload.createdAt, event.created_at * 1000)`. Display order is by effective time, then by event id.
3. `pledged` = sum of `amount.amount` of pledge claims whose currency matches the item price currency. Pledges are only meaningful when the item has a price.
4. Full claims are granted in this order: purchased claims first, then reserved ones, each by effective time, then event id. Walk in that order, granting quantity while the granted total stays within `item.quantity`. Claims that do not fit are marked `conflict: true`. So a claim that is already marked purchased is never displaced by a reserved one, however it is dated.
5. State:
   - `claimed` when granted quantity equals `item.quantity`; `purchased` when all granted claims are purchased.
   - `funded` when the remaining amount is 0 and there is at least one counted pledge.
   - `partial` when some quantity is granted or some amount is pledged.
   - `available` otherwise.
6. Output includes `grantedQuantity`, `remainingQuantity`, `pledged`, `pledgeCount`, `target` (price × quantity), `remainingAmount = max(0, price × remainingQuantity − pledged)`, `surplus`, and per-claim rows (`mine`, `nickname`, `conflict`, `currencyMismatch`, effective `createdAt`) for display.

The giver client sets `createdAt` when the claim is first sent. If no relay accepts it (offline), the claim stays `unsent`, and repair re-stamps `createdAt` (and `updatedAt`) with the current time before sending it again. So a claim drafted offline is dated when it reaches the relays, not when it was written.

Clients stamp `created_at`, `createdAt` and `updatedAt` with the corrected clock (section 10, note 13), so an honest device with a wrong clock neither back-dates its claims nor has them dropped as future-dated. Before telling a giver a claim worked, the client runs these rules and sections 5 and 6 on its own event, on a fresh state built from everything it holds, the way another device would; it reports success only when the event would be accepted and counted, and otherwise says why (another claim was counted first, the wish is gone, or the event would be dropped).

Known limitation: there is no trusted clock among givers. A link holder can sign a claim with a `created_at` and `payload.createdAt` in the past (down to the event's ~400-day lifetime) and so rank ahead of honest reserved claims, or mark a claim purchased straight away. This is limited to people the owner gave the link to, and it cannot displace a claim that is already marked purchased by a reserved one.

## 7. Transport

```ts
interface Transport {
  publish(event: NostrEvent): Promise<PublishResult>;          // per-relay ok / error
  subscribe(filter: Filter, onEvent: (e: NostrEvent) => void, onEose?: (info: EoseInfo) => void): Unsubscribe;
  fetch(filter: Filter, opts?: { timeoutMs?: number }): Promise<NostrEvent[]>;
  close(): void;
}
```

Implementations:

- `NostrTransport(relays)`: `nostr-tools` `SimplePool`, which verifies signatures. Publish succeeds if at least one relay accepts. Results list each relay. `fetch` keeps at most 10,000 events.
- `MemoryTransport`: in-process, for tests and the offline demo. Honours addressable replacement, NIP-40 expiration (an expired event is refused even if a copy is stored) and `#t`, `authors`, `kinds`, `#d` filters.

Owner filters: `{ kinds:[30078], authors:[ownerPubkey], '#t':[topic] }`.
Giver filters: `{ kinds:[30078], '#t':[topic] }` (owner events and all claims).
The owner app never subscribes without the `authors` restriction.

Default relays (config constant, overridable in settings): `wss://relay.primal.net`, `wss://relay.snort.social`, `wss://offchain.pub`, `wss://relay.nostr.net`, `wss://relay.damus.io`, `wss://nos.lol`.

Developer override (end-to-end tests): `?relays=<comma-separated URLs>` in the page URL, copied into sessionStorage `hippo:relays`, forces every transport onto those relays. Only loopback `ws://` or `wss://` URLs are honoured; it lasts for the browser tab, and `core.forcedRelays` tells the UI to show a notice.

Relay canaries (maintenance only, never sent by the app): `scripts/relay-health.mjs` publishes one kind `30078` event per week to each default relay and looks for the ones from 1, 4 and 12 weeks ago. The author key is `sha256("hippo-relay-canary-v1:<ISO week>:0")` (for example week `2026-W47`), so any run can recompute earlier keys. Tags: `["d", "hippo:hippo-canary-<week>:item:probe"]`, `["t", "hippo-canary-<week>"]` and a NIP-40 `expiration` 100 days after creation. Real topics are 64 hex characters and canary topics are not, so a canary can never match a real list, and apps that follow section 5 reject it anyway. Content is random base64 of about the size of an item.

## 8. Repair

Relays may drop events. On opening a list the client compares what the relays return with its local cache and republishes its own events that are missing: the owner republishes meta and items; a giver republishes their own claims. Clients may also republish other authors' cached, verified events unchanged (events are self-authenticating). Expired events are never republished.

Own events whose expiration is less than 60 days away are re-signed with a new `created_at` (same payload) by sync and repair, so a list or claim that does not change does not lapse: the owner does this for the meta and live items of a published list, a giver for their own claims that are not withdrawn. A giver's `unsent` claims are re-stamped as described in section 6.

The owner also retries cutting off retired topics (section 9) on repair and at app start.

Owner sync state: every local change to a published list (list fields, or a linked item) sets `syncPending` in the same transaction; publishing a draft or rotating also sets `linkPending`. After each sync the device clears `syncPending` once no event of the list's current topic is waiting for a relay, and clears `linkPending` once a relay has accepted the meta event under the current link. `retryPendingSync` resends whatever is pending (published lists, the cut-off of unpublished lists, retired topics). The app runs it at start, on the browser's `online` event, when the page becomes visible, and on a backoff timer (8 seconds, doubling, at most 5 minutes) while anything is pending. A list with `linkPending` is shown as not shared yet and its link is not offered.

A giver's open list retries its own unsent claims every 15 seconds while any is pending, besides reconnecting when the relays come back.

## 9. Rotation, unpublish and delete

- Unpublish: publish an empty tombstone for every item slot (current items plus every item slot this device published) and meta with `status: 'unpublished'` and empty `itemIds`. This is idempotent: what is already cut off is not published again, and what no relay accepted is resent.
- Rotate: create a new `listSecret` and owner key. In one database transaction the new keys are saved and the old ones are stored in a `RetiredList` with `pending` secrets. Then the list is published under the new topic and the old topic is unpublished as above. There is no forwarding address (rotation exists to cut off holders of the old link). Claims are not migrated. An unpublished list stays unpublished under the new keys.
- Delete: the list record is removed and a `RetiredList` is stored in the same transaction; a list that was ever published is unpublished as above.
- Cut-off: once every tombstone and the unpublished meta for a retired topic have been accepted by at least one relay, the `pending` secrets are deleted and the topic's cache is cleared. Until then nothing is deleted, and repair retries. A crash at any point leaves either the old list or the new keys plus a pending retired record, both recoverable.

## 10. Implementation notes (agreed refinements)

These were settled while implementing `src/core/` and are part of the protocol.

1. `subscribe`'s `onEose` receives `{ relaysReached, relaysAnswered, relaysTotal }`. `relaysAnswered` counts relays that sent EOSE; a relay that accepts the connection but never answers is reached but not answered. A client shows "nothing found" only when at least one relay answered, and "cannot reach the sync servers" when none did.
2. An item tombstone is an owner-signed item event with empty content. Tombstones are sent on unpublish, rotation and delete only. Items removed from a live list are dropped from `itemIds` and left to expire, so givers who claimed them still see the title.
3. Expiration does not depend on the event date (section 4); re-signing near expiry (section 8) keeps live content available.
4. Funding counts granted full claims as covering their units: `remainingAmount = price * (quantity - granted) - pledged`.
5. Rotation and delete tombstone the old items as well as unpublishing the old meta.
6. A replacement event always carries a `created_at` greater than the version it replaces.
7. Money amounts are limited to 10^11 minor units so sums stay exact. Payload URLs that are not `http:` or `https:` are dropped during validation.
8. A full claim is refused on an item that already has pledges; clients offer "Cover the rest" instead. "Cover the rest" is a pledge, so like any new pledge it is refused (`contributions-disabled`) when the item does not allow contributions. Once contributions are off, a giver may still lower or withdraw an existing pledge but not raise it.
9. FR-25: a device refuses to add or open as a guest any list whose topic or owner key belongs to a list it owns, has rotated away from, or has deleted. Backups carry retired lists; importing refuses a file in which a guest list is one of the owned or retired lists (on the device or in the file), or a shared list is one the device holds as a guest.
10. Import in merge mode never replaces a shared, guest or retired list already on the device (matched by id, list secret or topic); items and categories in the file win. Replace mode records owned lists it drops as deleted retired lists. Imported keys must be valid secp256k1 keys, owner public keys must be curve points, and each guest list's topic must equal the topic derived from its secret.
11. Removing a list shared with me hides the guest record (`hiddenAt`) instead of deleting it. The guest key, nickname and cached events stay, so opening the same link again unhides it with the same identity and the giver's claims are still theirs. Hidden lists are not listed, not opened by topic and not synced; backups include them.
12. A giver remembers the title of each item they claimed (`claimTitles`), because tombstones carry no title. It is shown for claims on items the owner removed or after the owner stopped sharing.
13. Device clock. Every time a client writes (`created_at`, `createdAt`, `updatedAt`, the NIP-40 expiration) or judges (the future-dated check in section 5, expiry, re-signing near expiry) comes from one injected clock, `CoreDeps.now`, never from the device clock directly. The app's clock (`TimeSync`) is the device clock plus a measured offset. The offset comes from the `Date` header of a HEAD request to the app's own address with a fresh query string (on GitHub Pages, GitHub's servers; never a third party), corrected for half the round trip, the header's whole seconds and any `Age`; a sample with a round trip over 10 seconds is ignored. It is measured at start, every 30 minutes, when the page becomes visible again (at most every 5 minutes), when the browser comes back online, and when the wall clock and the monotonic clock (`performance.now`) drift more than 2 seconds apart (the device clock was changed, or the device slept). The last offset is kept in localStorage for at most 24 hours so a restart is corrected before the first answer. Relay data is never used as a time source: anyone with the link can write it. Without any measurement (offline on a first visit) the device clock is used as it is. A giver's list waits up to 3 seconds for the first measurement before judging events, and asks the relays again when the offset changes by more than a minute, so events judged with the wrong time are not lost. When the offset is more than 2 minutes the app tells the person once.

Known limitation: claim-slot ownership is "first author seen on this device". A giver who already holds the link could publish a backdated event into another giver's claim slot and win on a device that has not yet seen the original. The effect is limited to hiding or replacing one claim for some viewers, among people the owner already trusted with the link. Closing this would need claim ids bound to the author's key (for example `claimId = H(pubkey || nonce)`), which is planned for protocol v2.
