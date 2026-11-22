# Hippo — Product Requirements

Hippo is a gift registry named after "I Want a Hippopotamus for Christmas". A person keeps one private wishlist, links items from it into shared lists, and sends each shared list to family and friends as a link. Givers mark items as taken or pledge part of the cost. The list owner does not see any of that.

Status: v1 in development. License: MIT.

## 1. Goals

1. Add an item in a few seconds from a phone share sheet, a pasted URL, or by hand.
2. One private wishlist with categories, importance and notes.
3. Any number of shared lists, each a chosen subset of the private wishlist, each with its own link.
4. Givers claim items or pledge partial amounts without creating an account.
5. The owner sees nothing about claims. Givers are anonymous unless they choose a nickname, which only other givers see.
6. No paid infrastructure and no server operated by the project. Anyone can self-host by forking and enabling GitHub Pages.

## 2. Non-goals (v1)

- Payment processing or moving money. Pledges are records only; givers settle among themselves.
- Accounts, email, passwords, notifications by email or push.
- Price tracking, affiliate links, store integrations.
- Native apps. Hippo is an installable PWA.
- Automatic fetching of product pages (not possible from a static app because of CORS).

## 3. Personas

| Persona | Needs |
|---|---|
| Owner | Capture wants quickly, organise them, share selected items per occasion, stay unspoiled |
| Giver | Open a link, see what is wanted and what is still available, claim or chip in, undo |
| Self-hoster | Fork, enable Pages, have a working instance with no secrets or configuration |

## 4. Functional requirements

### 4.1 Private wishlist (owner)

- FR-1 Create, edit, archive and delete items. Fields: title (required), URL, image URL, price and currency, quantity wanted (default 1), importance, notes, categories, "allow contributions" flag.
- FR-2 Importance has three levels: `nice` (Nice to have), `want` (Want), `love` (Would love). Default `want`.
- FR-3 Categories: create, rename, reorder, delete. An item can be in several categories. Deleting a category does not delete items.
- FR-4 Filter by category and importance; sort by importance, date added, price.
- FR-5 All private data is stored on the device (IndexedDB). Nothing is published until the owner shares a list.
- FR-6 Export all data to a JSON file and import it again (backup, device move).

### 4.2 Capture

- FR-7 Paste a URL: the app creates a draft item with the URL and a title guessed from the URL; the owner completes the rest.
- FR-8 Share target (Android, desktop Chromium, installed PWA): Hippo appears in the system share sheet and opens the Add Item form prefilled from the shared `title`, `text` and `url`.
- FR-9 Deep link: `/?title=&text=&url=&image=&price=&currency=` opens the same prefilled form. This is the entry point for the iOS Shortcut and the bookmarklet, which read the page's metadata themselves and pass it along. They send the page's canonical link when it has one (else the address without its fragment), and well-known tracking parameters (`utm_*`, `fbclid`, `gclid` and similar) are removed from captured links, since a published wish shows its link to givers.
- FR-10 Settings shows install instructions for the bookmarklet and the iOS Shortcut recipe.

### 4.3 Shared lists (owner)

- FR-11 Create a shared list: name, optional occasion date, optional message to givers.
- FR-12 Choose which private items are linked into the list. Items are linked, not copied: editing the private item updates every shared list that includes it.
- FR-13 Per-list settings: show prices (default on), show notes (default on).
- FR-14 The "allow contributions" flag is per item and defaults to off. When on, givers may pledge partial amounts toward that item.
- FR-15 Publishing produces a share link. The owner can copy it or hand it to the system share sheet.
- FR-16 The owner can unpublish a list (givers see "this list is no longer shared") and can rotate the link (old link stops receiving updates).
- FR-17 The owner's view of a shared list never shows claim or pledge state and the owner's app never downloads it.

### 4.4 Giver experience

- FR-18 Opening a share link shows the list name, message, date and items, with importance, notes and price as allowed by the list settings. No account or install is required.
- FR-19 A giver can claim an item ("I'll get this"), choose a quantity when more than one is wanted, mark their claim as purchased, and withdraw it.
- FR-20 For items that allow contributions, a giver can pledge an amount. Givers see the total pledged against the price as a progress indicator. A giver can change or withdraw their pledge.
- FR-21 A giver may set a nickname for a list. It is shown to other givers next to their claims and pledges. Without one, they appear as "Someone".
- FR-22 Item states for givers: available, partly funded, fully funded, claimed, purchased, removed by owner.
- FR-23 If two givers claim the same item at the same time, the earliest claim wins and the later giver sees a conflict notice on their own claim.
- FR-24 Opened lists are remembered on the giver's device under "Lists shared with me". Removing one hides it but keeps the giver's identity, so opening the link again lets them change or take back their claims. After a list is opened, the share link's secret is replaced in the address bar by the remembered list's address; givers can copy the link from the list to invite others.
- FR-25 If the giver is also the owner of that list on this device, the app refuses to show claim state and explains why.

### 4.5 Anonymity and security

- FR-26 List content and claims are end-to-end encrypted. The decryption key travels only in the URL fragment of the share link. Relays store ciphertext.
- FR-27 Only the owner's key can publish or change list content. Only a claim's author can change or withdraw that claim.
- FR-28 The app makes no requests to third parties except the configured relays, and item images that the owner chose to attach (loaded with `referrerpolicy="no-referrer"`).

Threat model:

| Party | Can see | Cannot see |
|---|---|---|
| Relay operator | Ciphertext, event sizes and timing, IP addresses | List content, claims, who is linked to whom by name |
| Someone without the link | Nothing | Everything |
| Giver with the link | List content, all claims and pledges, nicknames | Other givers' identities beyond nicknames |
| Owner | Their own list content | Claims and pledges, as long as they use the app as intended |

Known limitation: hiding claims from the owner is enforced by the app, not by cryptography. The owner created the link and could open it in another browser as a giver. This is true of any link-shared registry without giver accounts.

### 4.6 Edge cases

- Owner removes an item that has claims: no warning to the owner (a warning would leak state). Givers see the item as "removed by owner" with their claim preserved.
- Owner changes a price after pledges exist: progress recomputes against the new price.
- Owner turns contributions off after pledges exist: existing pledges stay visible to givers; new pledges, including "Cover the rest", are blocked. A giver may still lower or withdraw their own pledge.
- Pledges exceed the price: shown as fully funded; the surplus is displayed to givers.
- An item has pledges and someone wants to claim it outright: the action is labelled "Cover the rest" and records a pledge for the remainder.
- Relay unavailable: the app works from its local cache and retries (at start, when back online, when the app returns to the foreground, and on a backoff timer); publishing shows which relays accepted. A list no relay has accepted yet is shown as not shared yet, without a link.
- Owner stops sharing or replaces the link: givers see that the list is no longer shared, with the titles of what they had said they would get or chip in on.
- Lost device: the owner restores from an export file. (Recovery code and multi-device sync are planned for a later milestone.)

## 5. Non-functional requirements

- Works offline after first load; installable; share target registered in the manifest. Hippo asks the browser to keep its data (persistent storage) after the first wish or list, and suggests a backup when the browser declines. If storage cannot be opened at all, the app says so instead of loading forever.
- Accessibility: WCAG 2.2 AA. Keyboard operable, visible focus, 44px minimum touch targets, respects `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast`.
- Performance: initial JS under 200 kB gzip; interactive in under 2 s on a mid-range phone.
- Privacy: no analytics, no third-party fonts or scripts.
- Browser support: current Chrome, Edge, Firefox, Safari (desktop and mobile).

## 6. Architecture summary

- Static PWA: React + TypeScript + Vite, deployed to GitHub Pages by a GitHub Actions workflow.
- Local data: IndexedDB via Dexie.
- Sync: end-to-end encrypted events on public Nostr relays, behind a `Transport` interface so another backend can replace relays. See `PROTOCOL.md`.
- Design system: see `DESIGN.md`.

Code layout:

| Path | Contents |
|---|---|
| `src/core/` | Framework-free TypeScript: model, crypto, protocol, transports, database, services |
| `src/ui/` | Design system: tokens, styles, components |
| `src/app/` | Screens, routing, hooks that bind `core` to `ui` |
| `e2e/` | Playwright end-to-end tests |
| `docs/` | This document, protocol, design system |

## 7. Milestones

| # | Scope | Status |
|---|---|---|
| M0 | Relay acceptance test | Done: 4 of 8 public relays tried accepted and returned an encrypted kind-30078 event; long-term retention not yet measured |
| M1 | Private wishlist, installable PWA, Pages deploy | In progress |
| M2 | Shared lists: publish, link, giver view | In progress |
| M3 | Claims, pledges, conflicts, owner-side hiding | In progress |
| M4 | Share target, deep link, bookmarklet, iOS Shortcut recipe | In progress |
| M5 | Recovery code, multi-device sync, relay retention monitoring, optional self-hosted relay | Planned |
