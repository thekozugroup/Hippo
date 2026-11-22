# src/core

Framework-free TypeScript: model, crypto, protocol, transports, database and services. Import everything from `src/core/index.ts`. The contract is `docs/PROTOCOL.md`.

Every expected failure throws `HippoError` with a `code` (`invalid-link`, `own-list`, `not-found`, `invalid-input`, `invalid-import`, `unsupported-version`, `not-published`, `list-unpublished`, `item-unavailable`, `contributions-disabled`, `not-my-claim`). Use `isHippoError(e, code)`.

## Setup

| Function | What it does |
|---|---|
| `applyRelayOverrideFromUrl(location.href)` | Copies `?relays=ws://127.0.0.1:7447` (loopback only) into sessionStorage `hippo:relays`, so it lasts for this tab only. Call before `createCore`. `readRelayOverride()` returns the active override. |
| `createCore(options?)` | Returns `{ db, transports, now, forcedRelays?, close() }`, the `deps` every service takes. Nostr relays by default; pass `transport` to use a `MemoryTransport`. |

**End-to-end tests:** start `node src/core/testing/mock-relay.ts` (port from `MOCK_RELAY_PORT`, default 7447; prints `mock relay listening on ws://127.0.0.1:<port>`), then either open the app with `?relays=ws://127.0.0.1:7447` or set sessionStorage `hippo:relays` with `page.addInitScript`. Only loopback relays are honoured. Every transport, including list and link relays, then uses only those relays. The UI should show when `core.forcedRelays` is set. `startMockRelay(port?)` returns `{ url, port, events, filters, clear(), close() }` for use inside Node tests.

## Wishlist (`db` = `core.db`)

| Function | What it does |
|---|---|
| `createItem(db, input, now?)` | New item; validates and trims; defaults: quantity 1, importance `want`, contributions off. |
| `updateItem(db, id, patch, now?)` | Patch fields; `null` clears an optional field. |
| `archiveItem` / `unarchiveItem(db, id)` | Archived items are hidden and left out of published lists. |
| `deleteItem(db, id)` | Deletes and unlinks from shared lists; returns the changed list ids. |
| `getItem`, `listItems(db, { includeArchived? })` | Reads. |
| `filterAndSortItems(items, { categoryId?, importance?, sort? })` | Pure FR-4 filter/sort (`importance`, `newest`, `oldest`, `price-asc`, `price-desc`). |
| `listCategories`, `createCategory(db, name, emoji?)`, `updateCategory`, `reorderCategories(db, ids)`, `deleteCategory` | Categories; deleting removes the id from items. |

After any item change, call `syncListsForItem(core, itemId)` to republish lists that include it.

## Capture (pure)

| Function | What it does |
|---|---|
| `captureFromSearchParams(location.search)` | Reads `title,text,url,image,price,currency` from a deep link / share target; `null` if none. |
| `draftFromCapture(input)` | `{ title, url?, imageUrl?, price? }` for the Add Item form. |
| `findFirstHttpUrl`, `guessTitleFromUrl`, `parsePrice(str, currency?)`, `currencyDigits(code)` | The pieces. `parsePrice` returns minor units or `undefined` when ambiguous. |

## Shared lists I own (`core` as deps)

| Function | What it does |
|---|---|
| `createSharedList(core, { name, message?, eventDate?, itemIds?, showPrices?, showNotes? })` | Draft list with fresh keys and the current relays. |
| `updateSharedList(core, id, patch)` | Local change; then `syncList`. Reorder or link items via `itemIds`. |
| `publishList(core, id)` | Marks published, publishes items and meta. Returns `SyncReport { ok, events[{ d, kind, result }] }` with per-relay results. |
| `syncList(core, id, { force? })` | Republishes only what changed (plus anything no relay accepted yet). No-op unless published. |
| `syncListsForItem(core, itemId)` / `findListsContainingItem(db, itemId)` | Lists affected by an item change. |
| `unpublishList(core, id)` | Givers see "no longer shared". `publishList` again re-shares under the same link. |
| `rotateList(core, id)` | New link; old link is cut off; claims are not migrated. The old keys stay in `retiredLists` until relays accept the cut-off (`unpublishedOld.ok` is false until then). |
| `deleteSharedList(core, id)` | Deletes and remembers the topic and owner key (FR-25); cuts off a published link, retried by `repairRetiredLists`. |
| `repairRetiredLists(core)` | Retries cutting off old links of rotated or deleted lists. Call at startup and when back online. `listRetiredLists(db)` lists them without secrets. |
| `repairOwnerList(core, id)` | Call when opening a list: republishes events relays lost, re-signs events near expiry, retries this list's retired topics. |
| `buildShareLink(list, appBaseUrl)` | `https://host/base/#/l/<payload>`. |
| `sharedItemIdFor(list, localItemId)` / `localItemIdFor(list, sharedId)` | Givers see per-list item ids derived from the local id; these map between them. |
| `getSharedList`, `listSharedLists`, `topicOfList` | Reads. |

The owner side never reads claims: every request is restricted to the owner's key, and owner code never derives the claims key.

## Lists shared with me

| Function | What it does |
|---|---|
| `addGuestListFromLink(core, linkOrPayload)` | Validates the link, stores the list with a new guest key; throws `own-list` when this device owns, rotated or deleted the list (FR-25). Idempotent. |
| `buildGuestShareLink(guest, appBaseUrl)` | Rebuilds the share link of a list shared with me. |
| `listGuestLists(db)` | "Lists shared with me" with cached names. |
| `removeGuestList(db, topic)` | Forget a list on this device. |
| `openGuestList(core, topic, opts?)` | Returns a `GiverListSession`; call `start()` and later `stop()`. |
| `session.subscribe` / `session.getSnapshot` | Use with `useSyncExternalStore`. Snapshot: `{ status, meta, items[{ item, state }], removedItemsWithMyClaims, myPubkey, nickname?, pendingClaimIds }`. `status` is `loading`, `live`, `offline` or `unpublished`; `meta === null` after `live` means nothing was found. |
| `session.claim(itemId, quantity?)` | Full claim. Throws `invalid-input` when the item has pledges (use `coverTheRest`). |
| `session.pledge(itemId, amountMinor)` | Pledge in the item currency; needs contributions on and a price. |
| `session.coverTheRest(itemId)` | Pledges exactly `state.remainingAmount`. |
| `session.updateClaim(claimId, { quantity?, amount? })`, `markPurchased(claimId, purchased?)`, `withdraw(claimId)` | Edit my own claims only (`not-my-claim` otherwise). |
| `session.setNickname(name?, { applyToExisting? })` | Max 40 characters. |
| `session.repair()` | Manual re-sync; runs automatically when the session goes live. |

Claim actions return `{ claim, result: PublishResult }`. They update the view immediately; if `result.ok` is false the claim id stays in `pendingClaimIds` and is retried.

`state` (from `resolveItemState`): `status` (`available`, `partial`, `funded`, `claimed`, `purchased`), `grantedQuantity`, `remainingQuantity`, `pledged`, `target?`, `remainingAmount?`, `surplus`, and `rows[]` with `mine`, `nickname`, `conflict`, `currencyMismatch`. Show "Someone" when `nickname` is missing. Purchased claims are counted before reserved ones, so `conflict` on my row means another claim was counted first or someone already bought it; word it kindly.

## Backup and settings

| Function | What it does |
|---|---|
| `exportData(db)` | JSON-serialisable object with all data **including private keys**; records the export time. |
| `importData(db, parsedJson, { mode: 'merge' \| 'replace' })` | Validates everything first; rejects other versions, any bad record, and FR-25 conflicts (`invalid-import`). Merge never replaces lists already on the device (`skippedLists`). |
| `getSettings(db)`, `setTheme(db, theme)`, `setRelayOverride(db, relays?)` | Settings; the relay override applies to lists created afterwards and accepts public `wss://` relays only (`isRelayUrl`). |

## Other exports

`resolveItemState`, `parseShareLink`, `isSafeHttpUrl` (check before rendering any URL as a link or image), `LIMITS`, `DEFAULT_RELAYS`, `MemoryTransport`/`MemoryNetwork`, `NostrTransport`, `createNostrTransportProvider`, `staticTransport`, `HippoDb`/`openDb`, and the model types.
