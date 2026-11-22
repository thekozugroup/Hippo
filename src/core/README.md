# src/core

Framework-free TypeScript: model, crypto, protocol, transports, database and services. Import everything from `src/core/index.ts`. The contract is `docs/PROTOCOL.md`.

Every expected failure throws `HippoError` with a `code` (`invalid-link`, `own-list`, `not-found`, `invalid-input`, `invalid-import`, `unsupported-version`, `not-published`, `list-unpublished`, `item-unavailable`, `contributions-disabled`, `not-my-claim`). Use `isHippoError(e, code)`.

## Setup

| Function | What it does |
|---|---|
| `applyRelayOverrideFromUrl(location.href)` | Copies `?relays=ws://127.0.0.1:7447` (loopback only) into sessionStorage `hippo:relays`, so it lasts for this tab only. Call before `createCore`. `readRelayOverride()` returns the active override. |
| `createCore(options?)` | Returns `{ db, transports, now, clockSync?, forcedRelays?, close() }`, the `deps` every service takes. Nostr relays by default; pass `transport` to use a `MemoryTransport`. Pass `clock` (a `TimeSync`) to correct a wrong device clock, or `now` for a fixed test clock. |
| `new TimeSync({ url, storage? })` | The corrected clock (PROTOCOL.md section 10, note 13): `now()`, `offset()` (ms the device is behind; undefined until measured), `ready()`, `refresh()`, `refreshIfOlderThan(ms)`, `subscribe(fn)`. Measures with a HEAD request to `url` (the app's own address) and its `Date` header. `CLOCK_WARN_MS` (2 minutes) is when to tell the person; `describeClockOffset(ms)` words it. Every stamp and every time check in core comes from `deps.now`; `systemNow` is the uncorrected default for tests. |

**End-to-end tests:** start `node src/core/testing/mock-relay.ts` (port from `MOCK_RELAY_PORT`, default 7447; prints `mock relay listening on ws://127.0.0.1:<port>`), then either open the app with `?relays=ws://127.0.0.1:7447` or set sessionStorage `hippo:relays` with `page.addInitScript`. Only loopback relays are honoured. Every transport, including list and link relays, then uses only those relays. The UI should show when `core.forcedRelays` is set. `startMockRelay(port?)` returns `{ url, port, events, filters, clear(), pause(), resume(), close() }` for use inside Node tests; `pause()` drops and refuses connections (keeping stored events) to simulate an outage.

## Wishlist (`db` = `core.db`)

| Function | What it does |
|---|---|
| `createItem(db, input, now?)` | New item; validates and trims; defaults: quantity 1, importance `want`, contributions off. |
| `updateItem(db, id, patch, now?)` | Patch fields; `null` clears an optional field. |
| `mergeItemEdit(db, id, patch, base, now?)` | An editor's save: writes only `patch` onto the stored item in one transaction; returns `{ item, changedElsewhere }`, the patched fields whose stored value no longer equals `base` (the value the form loaded). |
| `archiveItem` / `unarchiveItem(db, id)` | Archived items are hidden and left out of published lists. |
| `deleteItem(db, id)` | Deletes and unlinks from shared lists; returns the changed list ids. |
| `getItem`, `listItems(db, { includeArchived? })` | Reads. |
| `filterAndSortItems(items, { categoryId?, importance?, sort? })` | Pure FR-4 filter/sort (`importance`, `newest`, `oldest`, `price-asc`, `price-desc`). |
| `listCategories`, `createCategory(db, name, emoji?)`, `updateCategory`, `reorderCategories(db, ids)`, `deleteCategory` | Categories; deleting removes the id from items. |

After any item change, call `syncListsForItem(core, itemId)` to republish lists that include it. `updateItem`, `archiveItem`, `unarchiveItem` and `deleteItem` already flag the published lists that link the item as `syncPending`, so a change that no relay accepts (or an app closed mid-sync) is sent later by `retryPendingSync`.

## Capture (pure)

| Function | What it does |
|---|---|
| `captureFromSearchParams(location.search)` | Reads `title,text,url,image,price,currency` from a deep link / share target; `null` if none. |
| `draftFromCapture(input)` | `{ title, url?, imageUrl?, price? }` for the Add Item form. |
| `findFirstHttpUrl`, `guessTitleFromUrl`, `parsePrice(str, currency?)`, `currencyDigits(code)` | The pieces. `parsePrice` returns minor units or `undefined` when ambiguous. |
| `stripTrackingParams(url)`, `isTrackingParam(name)`, `TRACKING_PARAMS` | Remove well-known tracking parameters (`utm_*`, `fbclid`, `gclid`, ...) and text fragments from a captured link; other parameters are kept. `draftFromCapture` applies it. |

### Link preview (opt-in; shown to people as "Link lookup" in Settings)

For wishes added from a pasted link or the share sheet. Off by default; see the README security notes.

| Function | What it does |
|---|---|
| `getLinkPreviewEnabled(db)`, `setLinkPreviewEnabled(db, enabled)` | The opt-in. Stored in the `settings` table under key `LINK_PREVIEW_SETTING_KEY` (`'linkPreview'`); only the boolean `true` means on. |
| `lookupLinkPreview(url, { db, fetch?, timeoutMs?, signal? })` | Never throws. Aborting `signal` stops the request and returns `{ kind: 'cancelled' }`. Returns `{ kind: 'found', patch: { title?, imageUrl?, price? } }`, `{ kind: 'nothing-found' }`, `{ kind: 'failed', reason: 'timeout' \| 'network' \| 'rate-limited' \| 'service-error' \| 'bad-response' }`, `{ kind: 'disabled' }` (setting off, nothing sent) or `{ kind: 'invalid-url' }` (not https or not a public host, nothing sent). Sends one GET with only the cleaned link (tracking parameters and fragment removed) to `LINK_PREVIEW_HOST` (`api.microlink.io`). Default timeout 6 s. |
| `fillEmptyFields(current, patch)` | Returns the part of the patch that fills fields the user left empty. Pass a blank `title` when the current title is only a guess from the URL (`draftFromCapture`). |

The UI toggle must show this sentence, unchanged (`LINK_PREVIEW_DISCLOSURE`): "Hippo will send each link you add to Microlink (api.microlink.io), a third-party service, so it can look up the page's title and picture. Nothing else is sent." Call `lookupLinkPreview` only for a link the user just added, never for links read from lists. A price is returned only if the service supplies one; Microlink usually does not.

## Shared lists I own (`core` as deps)

| Function | What it does |
|---|---|
| `createSharedList(core, { name, message?, eventDate?, itemIds?, showPrices?, showNotes? })` | Draft list with fresh keys and the current relays. |
| `updateSharedList(core, id, patch)` | Local change; then `syncList`. Reorder or link items via `itemIds`. |
| `publishList(core, id)` | Marks published, publishes items and meta. Returns `SyncReport { ok, events[{ d, kind, result }] }` with per-relay results. Sets `linkPending` until a relay has the list: show "Not shared yet" and do not offer the link while it is set. |
| `syncList(core, id, { force? })` | Republishes only what changed (plus anything no relay accepted yet). No-op unless published. |
| `retryPendingSync(core)` | One retry pass over everything not yet on a relay: lists with `syncPending` (published or unpublished) and retired links. Returns `{ reports, pending }`. Cheap when nothing is pending. The app runs it at start, on `online`, when the page becomes visible, and on a backoff timer while `pending`. `hasPendingSync(db)` only checks. |
| `syncListsForItem(core, itemId)` / `findListsContainingItem(db, itemId)` | Lists affected by an item change. |
| `unpublishList(core, id)` | Givers see "no longer shared". `publishList` again re-shares under the same link. |
| `rotateList(core, id)` | New link (with `linkPending` until a relay has it); old link is cut off; claims are not migrated. The old keys stay in `retiredLists` until relays accept the cut-off (`unpublishedOld.ok` is false until then). |
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
| `addGuestListFromLink(core, linkOrPayload)` | Validates the link, stores the list with a new guest key; throws `own-list` when this device owns, rotated or deleted the list (FR-25). Idempotent; restores a hidden list with its old guest key. |
| `buildGuestShareLink(guest, appBaseUrl)` | Rebuilds the share link of a list shared with me (to invite others). |
| `getGuestList(db, topic)` | The stored record, hidden or not. |
| `listGuestLists(db)` | "Lists shared with me" with cached names; hidden lists are left out. |
| `hideGuestList(core, topic)` | "Remove from this device": hides the list but keeps its guest key, nickname and cache, so reopening the link makes the giver's claims theirs again. Hidden lists are not listed, not opened by topic (`not-found`) and not synced; backups include them. |
| `openGuestList(core, topic, opts?)` | Returns a `GiverListSession`; call `start()` and later `stop()`. |
| `session.subscribe` / `session.getSnapshot` | Use with `useSyncExternalStore`. Snapshot: `{ status, meta, items[{ item, state }], removedItemsWithMyClaims, myPubkey, nickname?, pendingClaimIds }`. `status` is `loading`, `live`, `offline` or `unpublished`; `meta === null` after `live` means nothing was found. |
| `session.claim(itemId, quantity?)` | Full claim. Throws `invalid-input` when the item has pledges (use `coverTheRest`). |
| `session.pledge(itemId, amountMinor)` | Pledge in the item currency; needs contributions on and a price (`contributions-disabled` otherwise). |
| `session.coverTheRest(itemId)` | Pledges exactly `state.remainingAmount`; also `contributions-disabled` when the item does not allow contributions. |
| `session.updateClaim(claimId, { quantity?, amount? })`, `markPurchased(claimId, purchased?)`, `withdraw(claimId)` | Edit my own claims only (`not-my-claim` otherwise). A pledge on an item whose contributions are off can be lowered but not raised (`contributions-disabled`). |
| `session.setNickname(name?, { applyToExisting? })` | Max 40 characters. |
| `session.repair()` | Manual re-sync; runs automatically when the session goes live. |

Claim actions return `{ claim, result: PublishResult, outcome }`. `outcome` is what other devices make of the event, worked out with their rules on everything this device holds: `counted`, `not-counted` (`taken`, `currency`, `unavailable`) or `rejected` (for example `future`). Show success only for `counted`. `session.retryNow()` asks the relays again at once ("Try again"). `status` is `offline` when no relay answered (EOSE), even if sockets are open. They update the view immediately; if `result.ok` is false the claim id stays in `pendingClaimIds` and is retried every `retryMs` (15 s) while the session runs, and on reconnect.

`removedItemsWithMyClaims[].title` is the item's last known title (remembered for items I claimed), so it can still be shown after a tombstone or after the owner stops sharing (`status === 'unpublished'`).

`state` (from `resolveItemState`): `status` (`available`, `partial`, `funded`, `claimed`, `purchased`), `grantedQuantity`, `remainingQuantity`, `pledged`, `target?`, `remainingAmount?`, `surplus`, and `rows[]` with `mine`, `nickname`, `conflict`, `currencyMismatch`. Show "Someone" when `nickname` is missing. Purchased claims are counted before reserved ones, so `conflict` on my row means another claim was counted first or someone already bought it; word it kindly.

## Deployment checks and frame guard

| Function | What it does |
|---|---|
| `isFramed(window)` | True when `window.top !== window.self` (or reading it throws). |
| `blockIfFramed(window, document, location.href)` | Used by `src/main.tsx` before anything starts. When framed, replaces the page with a plain message and a link that opens Hippo in its own tab, and returns `true`. |
| `checkDeployment(env)` | Returns `Promise<DeploymentCheck[]>`. Never throws; waits at most the relay timeout (default 4 s). |
| `browserDeploymentEnv(relays)` | Builds `env` from the real `window`, `navigator`, `indexedDB` and `WebSocket`. Settings (the **Deployment checks** row, at the bottom) calls `checkDeployment(browserDeploymentEnv(relays))` with the forced test relays, else `getSettings(db).relays`, else `DEFAULT_RELAYS`. |

```ts
type CheckStatus = 'ok' | 'warning' | 'problem' | 'unknown'
interface DeploymentCheck {
  id: 'https' | 'own-origin' | 'not-framed' | 'service-worker' | 'indexeddb' | 'persistent-storage' | 'relays'
  status: CheckStatus
  finding: string // one sentence: what was found
  fix: string // one sentence: what to do; '' when status is 'ok'
}
```

The list always has these seven entries in this order. `unknown` means the browser or the situation gave no answer (for example the storage API is missing, or the device is offline), not that something is wrong. The `relays` finding reads "N of M relays answered." Show `problem` first, then `warning`, then `unknown`; show `fix` only when it is not empty. Tests inject `env` (`location`, `framed`, `navigator`, `probeIndexedDb`, `createWebSocket`, `relays`, `relayTimeoutMs`).

## Backup and settings

| Function | What it does |
|---|---|
| `exportData(db, now?)` | JSON-serialisable object (version 2) with all data **including private keys**, plus the owner's name, the Link lookup setting and whether setup is done; records the export time. |
| `importData(db, parsedJson, { mode: 'merge' \| 'replace' })` | Validates everything first; rejects other versions, any bad record, and FR-25 conflicts (`invalid-import`). Merge never replaces lists already on the device (`skippedLists`). Version 1 and 2 files are read. A restore that brings data marks setup as done unless it already ended on the device. |
| `getSettings(db)`, `setTheme(db, theme)`, `setRelayOverride(db, relays?)` | Settings; the relay override applies to lists created afterwards and accepts public `wss://` relays only (`isRelayUrl`). |
| `setOwnerName(db, name?)` | The owner's first name or nickname (max 40, whitespace collapsed; `RangeError` when longer). Published lists carry it as `ownerName` in their meta from their next sync, so call `syncList` for published lists after a change. |
| `setOnboarding(db, state?)`, `markSeen(db, flag, at)` | First-run setup progress (`{ status, step, answers, listId?, itemId?, updatedAt }`, validated on write and read) and one-time hints (`giverIntro`, `setupChecklist`, `linkPreviewHint`), returned by `getSettings` as `onboarding` and `seen`. |

## Other exports

`resolveItemState`, `parseShareLink`, `isSafeHttpUrl` (check before rendering any URL as a link or image), `LIMITS`, `DEFAULT_RELAYS`, `MemoryTransport`/`MemoryNetwork`, `NostrTransport`, `createNostrTransportProvider`, `staticTransport`, `HippoDb`/`openDb`, and the model types.
