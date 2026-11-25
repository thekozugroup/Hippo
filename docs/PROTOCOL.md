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

`<host><base>` is the address of the Hippo website that made the link. The Android app has no public address of its own (its pages come from `https://localhost` inside the APK), so links it makes use the public website it was built for (`HIPPO_SITE_URL`); the payload is the same. When Android opens such a link in the app, the app reads the payload only from a link to that website, and the same parsing rules apply.

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

## 11. Moving to another device (transfer link)

A one-time move of everything a backup file holds from one device to another, without a file. On its own it is not sync: afterwards each device keeps its own copy. With the account secret in its manifest it is a device link, which also signs the other device in (section 12.6). Code: `src/core/protocol/transfer.ts` (pure) and `src/core/services/transfer.ts`.

**Source.**

1. Generate a random 32-byte `transferSecret` and a fresh, random secp256k1 signing key `E` used for this transfer only.
2. Derive with HKDF-SHA256, `ikm = transferSecret`, `salt = "hippo-transfer/v1"`, 32-byte output: `contentKey` (`info = "content"`) and `topic` (`info = "topic"`, hex). The salt differs from the list derivations' (`"hippo/v1"`), so no transfer value equals a list value, and the slots below cannot be confused with list slots.
3. Take exactly the payload `exportData` produces (section "Backup" of `src/core/README.md`; it does not count as a backup for "last backup"), UTF-8 JSON. Refuse it when larger than 8 MiB. Compress it with gzip when the platform has `CompressionStream` (`encoding: "gzip"`, else `"none"`); refuse when the result is larger than 2 MiB (the person is told to move a file instead).
4. Split the result into chunks of `TRANSFER_CHUNK_BYTES` (24,536) bytes, so each event's content, `base64(nonce(24) || XChaCha20-Poly1305(chunk))`, is at most `TRANSFER_MAX_EVENT_CONTENT` (32,768) characters. The nonce is random; the associated data is the chunk's `d` slot, which binds the topic and the chunk index. At most 86 chunks.
5. Publish each chunk as a kind `30078` event signed by `E` with exactly the tags `["d", "hippo-transfer:<topic>:chunk:<i>"]` (decimal `i` from 0), `["t", <topic>]` and `["expiration", <unix seconds>]` (NIP-40), 15 minutes after creation. Then publish the manifest, `d = "hippo-transfer:<topic>:manifest"`, the same tags, content `encryptJson(contentKey, manifest, d)` (section 2's envelope, padded): `{ v: 1, kind: "manifest", chunks, length, sha256, encoding, key }`, where `length` is the byte length of the chunks together, `sha256` the hex SHA-256 of the backup JSON before compression, and `key` the hex secret of `E` (so the receiver can clear the chunks). The manifest goes last, so a device that finds it finds every chunk.
6. The link is `https://<site>/#/t/<payload>`, `payload = base64url(0x01 || transferSecret(32) || pubkey(E)(32) || expiresAt(uint32 big-endian, unix seconds) || utf8(relays joined by ","))`; the relay part is present only when the source does not use the default relays (as in section 3, public `wss://` relays only, 1 to 20). Parsing rejects any other version byte (as a newer version), wrong lengths, non-canonical base64url, payloads over 4,096 characters and a key that is not a curve point.

**Receiver.** Take the payload from a pasted link, from `#/t/<payload>` (removed from the address bar with `history.replaceState` before the app renders), or in the Android app from shared text or a link to the site. Refuse at once when `expiresAt` has passed (corrected clock). Subscribe with `{ kinds: [30078], authors: [pubkey(E)], "#t": [topic] }` and accept an event only if it passes section 5 rule 1 (shape, fresh copy, `verifyEvent`), is kind 30078 by `E`, has exactly one `t` equal to the topic and one `d` in one of the two slot shapes (chunk index without leading zeros, below the chunk limit), and carries an unexpired `expiration`. For each slot the newest valid event wins (section 5 rule 8); events that do not decrypt are never used. Then: the manifest must decrypt and validate (`chunks` 1..86, `length` consistent with `chunks`, `encoding` known, `publicKey(key) = pubkey(E)`); every chunk must be present, decrypt with its own slot as associated data and have the expected length; the concatenation must have `length` bytes; it is decompressed with an 8 MiB cap; its SHA-256 must equal `sha256`; the JSON goes through `parseExportFile`, exactly the validation of a backup file import. Each failure has its own reason (and `other-account` for a device link while this device is signed in to another account): `expired`, `not-found` (relays answered, nothing there), `offline` (no relay answered), `cancelled`, `used`, `missing`, `tampered`, `too-large`, `invalid-backup`, `unsupported-version`, `invalid-link`, `unsupported` (no `DecompressionStream`). Nothing is written until the person confirms. Writing is `importData(..., { mode: "merge" })` (lists already on the device are never replaced; there is no replace), and setup is marked done.

**Ending a transfer.** The receiver, after writing, signs with `key` (from the manifest): a manifest replacement `{ v: 1, kind: "done" }`, an empty tombstone in every chunk slot (each `created_at` greater than the original's), and NIP-09 deletion requests (kind 5, `["k","30078"]`, `["a","30078:<pubkey(E)>:<chunk slot>"]`, at most 12 per event, with the same expiration). The source watches the manifest slot with the same filter and shows "Moved" when it sees `done`. Cancelling on the source publishes the same with `{ kind: "cancelled" }`. A later fetch then fails with `used` or `cancelled`; once relays drop the expired events, with `expired` (from the link) or `not-found`.

**Security.** The transfer secret is treated like a share link's secret: it is only in the link, never logged, never in `document.title` or storage, removed from the address bar at once, and only derived values (the topic) are sent anywhere. Relays see a random one-time key, a random topic, sizes and timing, for 15 minutes. Anyone without the link sees nothing usable; an attacker who publishes on the topic cannot sign as `E` and is ignored, and a dishonest relay can only withhold or replay `E`'s own events, which fails as `missing` or `tampered`, never as wrong data. Anyone who has the link within the 15 minutes can read everything in it, like a backup file, and (holding `key` from the manifest) can also end or overwrite the transfer: the receiver's checks then refuse it.

## 12. Your Hippo account (sync between your devices)

A person's wishlist and lists follow them to every device and every web address they sign in on. There is no server and no password: the account is one random secret, held only in the IndexedDB of each signed-in device, and everything travels as encrypted addressable events on the same public relays. Code: `src/core/account/` (keys, records, recovery code, engine, service), wired into the app by `src/app/core/account.ts`.

### 12.1 Keys

- `accountSecret`: 16 random bytes (128 bits), made on the first device the first time the account is needed (showing the recovery code, adding a device, moving to a new address).
- HKDF-SHA256 with `ikm = accountSecret`, `salt = "hippo-account/v1"` (no list or transfer derivation uses this salt, so no value can collide with theirs), 32-byte outputs:

| Name | info | Use |
|---|---|---|
| `signKey` | `sign` (then `sign/1`, `sign/2`, ... in the negligible case the output is not a valid secp256k1 scalar) | signs every record event; its x-only public key is `accountPubkey` |
| `contentKey` | `content` | XChaCha20-Poly1305 key for record payloads (section 2's envelope, padded to 256 bytes) |
| `topic` | `topic` | hex; the `t` tag of every record |
| `slotKey` | `slot` | makes a record's slot: `slotId = hex(HMAC-SHA256(slotKey, utf8(type ":" id))[0..16])` |

Slots are opaque: a relay sees neither a record's type nor its id.

### 12.2 Recovery code

The secret is shown as 13 words from the BIP-39 English list: the 128 secret bits followed by a 15-bit checksum (the first 15 bits of `SHA-256("hippo-recovery/v1" || secret)`), read as thirteen 11-bit indexes. Thirteen is deliberately not a BIP-39 length, so no wallet takes the code. Parsing accepts any case, spacing, punctuation and numbering, and each word by its first four letters (unique in the list); it rejects the wrong number of words, unknown words, and any set whose checksum fails (a wrong or swapped word passes with probability 1 in 32,768). The list (6 kB compressed) is loaded only by the account screens.

Why words: they are read aloud without ambiguity (a base32 code is full of letters that sound alike: B, D, E, G, P, T, V, Z), survive handwriting, and can be typed as 52 letters; the checksum is stronger than two base32 check characters.

The secret is stored only in the device's database (settings key `account`, never in a backup file), never logged, and never put in a URL except inside a device link (12.6), which leaves the address bar before the app renders.

### 12.3 Records

| Type | Id | Fields (each synced separately) |
|---|---|---|
| `wish` | item id | every `Item` field but `id` |
| `category` | category id | `name`, `emoji`, `order` |
| `list` | list id | every `SharedList` field but `id`, `syncPending`, `linkPending`; `ownerSecretKey` and `listSecret` travel together as `keys`; `prev` lists the topics the list was rotated away from |
| `retired` | topic | every `RetiredList` field but `topic` (with `pending` secrets until the old link is cut off) |
| `guest` | topic | `ownerPubkey`, `listSecret`, `relays`, `nickname`, `hiddenAt`, `claimTitles`, and `identity = { guestSecretKey, addedAt }` (so the gifts a person said they would get stay theirs on every device); `lastOpenedAt` stays on the device |
| `profile` | `profile` | `ownerName`, `linkPreview`, `relays`, `setupDone`, `recoverySavedAt` |

Not synced: theme, install hints, the Android app's site address and shop-page setting, the device id, relay caches.

Payload (encrypted with `contentKey`, associated data = the event's `d`):

```ts
interface RecordPayload {
  v: 1
  type: 'wish' | 'category' | 'list' | 'retired' | 'guest' | 'profile'
  id: string
  data: Record<string, unknown>      // field values; a field without a value is absent
  f: Record<string, [number, string]> // per field: [ms on the corrected clock, device id]
  del?: [number, string]              // deleted: data and f are empty
}
```

The device id is 16 random bytes made once per device (settings key `deviceId`), never synced except inside stamps.

Event: kind `30078`, exactly the tags `["d", "hippo-acct:<topic>:<slotId>"]`, `["t", <topic>]` and `["expiration", ...]` (section 4's rule: 400 days, rounded to a month, plus 0 to 30 random days), signed by `signKey`. Content larger than 65,536 base64 characters is not sent (the record stays on the device).

### 12.4 Merge rules

A device keeps, per slot, the merged state of every version it has seen or written (`accountRecords` table, database version 3).

- Local writes: the fields that differ from the held state get the stamp `[max(now, newest stamp in the record + 1), deviceId]`, so a later edit always wins on the device that makes it, even after a stamp from a fast clock.
- Merging two states: deletion wins and is final; otherwise each field takes the value with the greater stamp (time, then device id). For `guest.identity`, the earliest `addedAt` wins (then the smaller key), so every device keeps one giver key. Merging is commutative, associative and idempotent, so devices that have seen the same versions hold the same state whatever the order. A wish edited on two devices while both were offline keeps the edits to different fields; for the same field, the later edit wins.
- A merged state that does not validate as a whole (fields from two versions that do not fit) is replaced by the newer version whole.
- First merge after signing in: for a record both sides hold, a field that differs takes the account's value and a field the account never had keeps this device's value; records only on this device are added. Duplicates by id collapse; nothing is lost.
- A device publishes a record only when its merged state differs from what it received for that slot, so two devices that agree stop writing. A replayed older event is ignored, except in a full fetch, where it shows a relay rolled back: then the newer version is sent again.
- Each event's `created_at` is greater than the newest one this device has seen for the slot.

Applying a merged record to the local tables uses the checks a backup import applies (section 10, notes 9 and 10): valid keys and public keys, a guest list's topic equal to its secret's topic, and a list cannot be both owned and shared with me. In addition:

- A list's keys are never swapped by the network. A record whose keys differ from the device's is applied only as a rotation made by the account (the device's current topic is in the record's `prev`, or already retired for that list); the old keys are then kept as a retired list, so the old link is still cut off. Otherwise (both devices rotated the same list) the device keeps its own version as a separate list with a new id: both links keep working and both sets of keys are kept.
- A deleted list's keys are kept as a retired list before the list is removed.
- An owned or retired list removes any guest record for the same topic or owner key on the device, together with its cached events (claims): the owner's devices never keep who is getting what. A guest record for a list the device owns or retired is refused and never applied.
- `setupDone` and `recoverySavedAt` never go back once set.

After a list comes from the account, the device fetches the events its owner key already published (owner filter, no claims key) and caches the newest verified ones, so its own next sync of the list replaces them instead of undercutting them. An owner device never publishes a list or item payload whose `updatedAt` is older than the cached one (another device published a newer one).

### 12.5 Sync engine

Local-first: every screen reads the local database, and the engine only moves changes in the background. A pass:

1. Fetches `{ kinds: [30078], authors: [accountPubkey], "#t": [topic] }`, with `since` = newest `created_at` seen minus 10 minutes, or without `since` (a full fetch) at sign-in and once a day. A live subscription with the same filter delivers other devices' changes as they happen.
2. In one database transaction: stamps local changes, merges every valid remote record (ordered: profile, retired lists, lists, categories, wishes, lists shared with me), writes what changed, and stamps what the merge itself changed (a forked list, a wish taken off a list). Slots the full fetch did not return, and records whose event expires within 60 days, are marked to send again; tombstones are kept on the relays for 2 years after deletion.
3. Publishes every record whose version the relays do not have, four at a time.

Passes never overlap. They run at start, after local changes (coalesced, 1.5 seconds), when live records arrive, and on the list-sync retry schedule (start, `online`, page visible, backoff from 8 seconds to 5 minutes while anything is unsent). Until the first merge after signing in has read the account, nothing is sent. Bounds: at most 30,000 records per account, 60,000 events and 32 MiB of content per fetch, 1,000 buffered live events.

Every received event is hostile until it passes: NIP-01 shape on a fresh copy, kind 30078, the account's key, exactly one `t` equal to the topic and one `d` of the account slot shape, at most one unexpired `expiration`, content of at most 65,536 characters, a valid signature, decryption with the slot as associated data, a payload that validates strictly (known type, id shape, only that type's fields, every value through the backup validators and limits, stamps no more than a day ahead of the corrected clock), and a slot equal to the one derived from the payload's own type and id.

Relays: the default relays always (so a recovery code alone finds the account) plus the relays set in Settings, at most 20.

### 12.6 Signing in

Three ways, all ending in the same state (the secret stored, the account's records merged with what the device holds, setup marked done):

- **Recovery code**: typed or pasted; checked on the device before anything is sent.
- **Device link**: section 11's transfer, with the account secret added to the encrypted manifest (`"account": <hex>`), so the link still works once, for 15 minutes, and its snapshot makes the new device usable before its first sync. Opening it on the new device, pasting it, sharing it into the Android app, or handing it to the Android app from a browser (`hippo://open/t/<payload>`, the only account route that address accepts) shows what will come in; the device signs in only after the person confirms (a sign-in nobody asked for, into someone else's account, would send them your later wishes). A link from an older Hippo without `account` still copies once.
- **New address**: when the website runs at an origin other than the one it was built for (`site` in `hippo.json`, embedded at build time), and this browser holds the person's own wishes or lists, Home shows "This Hippo site now lives at <host>". One tap turns the account on if needed, makes a device link for the new address and goes there. Never without the tap, and never for someone who only opened a shared list. (End-to-end tests serve one build on two loopback origins; on a loopback page only, `?site=<loopback url>` stands in for the built-in address for that tab.)

A device signed in to one account refuses a device link for another (`other-account`) until it signs out.

### 12.7 Changing the recovery code, signing out

- **Change**: a new secret; every record keeps its data and stamps and is sent again under the new keys (the "code saved" mark is cleared). Under the old key the device then publishes a marker (`{ type: "account", id: "status", retiredAt }`) and an empty event over every old slot, retried until they land. A device still on the old code that sees the marker stops syncing, keeps its data and asks the person to sign in with the new code.
- **Sign out on this device**: the secret and the record table are removed. The person chooses whether this device's wishes, lists and keys stay (they stop syncing) or are removed (from this device only; nothing is deleted on other devices or on the relays).
- **Sync off on this device**: nothing is fetched or sent; changes stay here.

### 12.8 What relays and others can see

| Who | Can see | Cannot see |
|---|---|---|
| Relay operator | One more public key and topic per account, how many records it has, their sizes (padded to 256 bytes), when each changes, IP addresses | Any content, record types or ids, which records are wishes or lists, which lists the account owns or was given |
| Someone who knows the topic only | The same | Anything else; they cannot sign as the account, so nothing they publish is accepted |
| Anyone with the recovery code (or an unused device link within 15 minutes) | Everything in the account, and they can change it | Claims on the person's own lists (owner devices never fetch them) |

Known limitations: relays keep the records only as long as they choose (a signed-in device or a backup file is the safety net); a device offline for longer than a tombstone lives (2 years) could bring back a deleted record; if the same shared list was opened separately on two devices before signing in, the earlier giver key is kept on both, and gifts marked with the other key stay counted but can no longer be changed; whoever had the old code still holds whatever a relay kept from before a code change.
