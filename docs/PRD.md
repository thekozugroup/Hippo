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
- App-store distribution. Hippo is an installable PWA, and an Android app built from the same code (FR-10d) that is published as an APK on GitHub Releases. There is no iOS app.
- Automatic fetching of product pages by the website itself (not possible from a static site because of CORS). On the website the only automatic lookup is the opt-in link preview in FR-10a, which asks a third-party service. The Android app reads the page on the phone instead (FR-10e).

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
- FR-6 Export all data to a JSON file and import it again (backup, device move). The file also holds the owner's name, the Link lookup setting and whether first-run setup is done, so a restore on a new device opens Home with the data, not setup.
- FR-6a Edits are not lost: saving a wish writes only the fields changed in that form onto the stored wish (another tab's changes to other fields stay), and says so when the same field was also changed elsewhere. Unsaved typing in the wish form is kept for the browser tab and comes back with a "Start over" action.

### 4.2 Capture

- FR-7 Paste a URL: the app creates a draft item with the URL and a title guessed from the URL; the owner completes the rest.
- FR-8 Share target (Android, desktop Chromium, installed PWA): Hippo appears in the system share sheet and opens the Add Item form prefilled from the shared `title`, `text` and `url`.
- FR-9 Deep link: `/?title=&text=&url=&image=&price=&currency=` opens the same prefilled form. This is the entry point for the iOS Shortcut and the bookmarklet, which read the page's metadata themselves and pass it along. They send the page's canonical link when it has one (else the address without its fragment), and well-known tracking parameters (`utm_*`, `fbclid`, `gclid` and similar) are removed from captured links, since a published wish shows its link to givers.
- FR-10 Settings shows install instructions for the bookmarklet and the iOS Shortcut recipe.
- FR-10b First-run setup: a new owner is asked, one question per screen, for a name, an occasion (which creates a draft list) and one wish, is shown how to put Hippo on the home screen, then one way to add wishes from that device. Every step can be skipped ("Skip" clears that step's answer), "Skip setup" on the first screen ends it, and Settings can run it again. Setup open in two tabs creates one list and one wish.
- FR-10c Installing. There is no app-store app: the browser's own install makes Hippo an app with an icon and its own window (on Android, also a place in the share sheet). Setup has a "Put Hippo on your home screen" step with the steps for this device and browser, in the words the device shows (two or three numbered actions with a plain icon each): the browser's install prompt as one "Install Hippo" button where it is offered (Android and desktop Chromium); the browser menu route for Chrome, Samsung Internet and Firefox on Android (generic wording for other Android browsers); Share, Add to Home Screen, Add in Safari on iPhone and iPad, and Share in the address bar for Chrome and Firefox on iOS; File, Add to Dock in Safari on a Mac; the menu route in Chrome and Edge on a computer; a bookmark in Firefox on a computer, which cannot install. Links opened inside another app (Instagram, Facebook, Messenger, the Google app and similar web views) are told to open Hippo in Safari or Chrome first, with "Copy link" (Hippo's own address, never a share link). Detection is a pure function of the user agent, client hint brands, touch points, whether Hippo runs installed and whether the prompt was offered, and falls back to generic wording when unsure.
  - Order: an app added to the Home Screen on iPhone and iPad (and to the Dock from Safari on a Mac) keeps its own storage, separate from the browser's, so there the step comes straight after the opening screen, says so in one sentence, and offers "Carry on in the browser"; the installed app starts setup afresh. In-app browsers also get it first. On Android and other computers the browser and installed app share storage, so the step comes just before "add wishes from anywhere". Running installed, there is no install step and it is not counted in the progress.
  - Later: the Home "Get set up" checklist includes the install task where installing is possible on the device (not Firefox on a computer), ticked once Hippo runs installed or the browser reports it installed; it opens the same steps in a sheet. Settings has an "Install Hippo" section with the same steps and, where the installed app keeps its own copy, how to move wishes across (Export backup in the browser, Import backup in the app). Nothing about installing is shown to givers, and nothing pops up on its own.
- FR-10d Android app. The same web app inside a Capacitor shell, with its files in the APK and its data in the app's own WebView storage (separate from the browser's; moved with a backup file). It adds: Hippo in Android's share sheet (ACTION_SEND, text/plain), handled at a cold start and while running, through the same capture path as FR-9; Back and the predictive back gesture closing an open sheet first, then going back in history, then leaving from a top-level screen; edge-to-edge layout with safe-area insets and system bar icons that follow the screen; a splash screen and an adaptive launcher icon from the hippo glyph; light haptic feedback when a gift is marked, a switch is turned or a deletion is confirmed (none under reduced motion or with touch feedback off); the system share sheet for share links and for saving a backup file. Every link the app makes or copies points at the public website (`HIPPO_SITE_URL` at build time), because the app's own address is local. Links to that website can open in the app where Android allows it (the person turns it on under Open by default; a GitHub Pages project site cannot publish the verification file), and Lists has "Open a list from a link" for a pasted link. There is no install step, install task or service worker in the app. Its data is excluded from Android cloud backup and device transfer, because it holds list keys. The only permission is Internet.
- FR-10e Reading shop pages (Android app only, on by default, a switch in Settings under Shop pages with the sentence "Hippo opens the shop page from your phone to read its name, picture and price; nothing is sent to anyone else."). For a link that was pasted, shared or prefilled, when the name, picture or price is empty, the phone fetches the page itself: `https` and public hosts only, every redirect and every resolved address checked, 8 seconds, 1.5 MB, no cookies, HTML only. Open Graph and product meta tags and JSON-LD `Product`/`Offer` data are read from an inert parsed copy, validated like any other input, and fill only empty fields; a newer link cancels the lookup. Microlink (FR-10a) is not offered in the app.
- FR-10a Link preview (opt-in, off by default). For a wish added by pasting a link or through the Android share sheet, Hippo can ask one third-party service (Microlink, `api.microlink.io`) for the page's title and picture. It runs only after the user turns it on in Settings, sends only the link (tracking parameters and fragment removed, https only), times out after a few seconds, and fills only fields the user has left empty. Answers are validated like any other untrusted input. The bookmarklet and Shortcut read the page themselves and need no third party; they remain the recommended method.

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
- FR-23 If two givers claim the same item at the same time, the earliest claim wins and the later giver sees a conflict notice on their own claim. A giver is told their claim worked only when other devices would accept and count it.
- FR-23a A device whose clock is wrong must not change who is getting what. The app measures the device clock against its own web host's `Date` header (in the Android app, the public website's, through native HTTP) and uses the corrected time for every date it writes or checks (PROTOCOL.md section 10, note 13), and says once, plainly, when the clock is more than about two minutes off.
- FR-24 Opened lists are remembered on the giver's device under "Lists shared with me". Removing one hides it but keeps the giver's identity, so opening the link again lets them change or take back their claims. After a list is opened, the share link's secret is replaced in the address bar by the remembered list's address; givers can copy the link from the list to invite others.
- FR-25 If the giver is also the owner of that list on this device, the app refuses to show claim state and explains why.

### 4.5 Anonymity and security

- FR-26 List content and claims are end-to-end encrypted. The decryption key travels only in the URL fragment of the share link. Relays store ciphertext.
- FR-27 Only the owner's key can publish or change list content. Only a claim's author can change or withdraw that claim.
- FR-28 The app makes no requests to third parties except the configured relays, item images that the owner chose to attach (loaded with `referrerpolicy="no-referrer"`, from any `https` host), and, only after the owner opts in (FR-10a), the link preview service. Its own host is asked for the time (a HEAD request to the app's address). The Android app also asks the public website for the time, and fetches the shop pages of links the person adds unless that is turned off (FR-10e); it never contacts Microlink.
- FR-29 Hippo refuses to run inside another site's frame (GitHub Pages cannot send `frame-ancestors`): before the app starts it shows a message with a link that opens Hippo in its own tab. The Android app is never framed and skips the check.
- FR-30 Settings can show deployment checks: HTTPS, an origin of its own, not framed, service worker, storage, persistent storage and relay reachability, each with a plain-language finding and fix. The Android app leaves out the origin, service worker and persistent storage checks.

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
- Relays reachable but silent: when no relay answers, the giver sees that Hippo cannot reach its sync servers and is retrying, with Try again; "this list could not be found" is shown only when relays answered and the list was not there. "You are offline" is shown only when the browser is offline.
- Relay unavailable: the app works from its local cache and retries (at start, when back online, when the app returns to the foreground, and on a backoff timer); publishing shows which relays accepted. A list no relay has accepted yet is shown as not shared yet, without a link.
- Owner stops sharing or replaces the link: givers see that the list is no longer shared, with the titles of what they had said they would get or chip in on.
- Lost device: the owner restores from an export file. (Recovery code and multi-device sync are planned for a later milestone.)

## 5. Non-functional requirements

- Works offline after first load; installable (FR-10c); share target registered in the manifest. Hippo asks the browser to keep its data (persistent storage) after the first wish or list, and suggests a backup when the browser declines. If storage cannot be opened at all, the app says so instead of loading forever.
- Accessibility: WCAG 2.2 AA. Keyboard operable, visible focus, 44px minimum touch targets, respects `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast`.
- Performance: initial JS under 200 kB gzip; interactive in under 2 s on a mid-range phone.
- Privacy: no analytics, no third-party fonts or scripts.
- Browser support: current Chrome, Edge, Firefox, Safari (desktop and mobile). Android app: Android 7.0 (API 24) and later, built against API 36.

## 6. Architecture summary

- Static PWA: React + TypeScript + Vite, deployed to GitHub Pages by a GitHub Actions workflow.
- Android app: the same build in native mode (`vite build --mode native`) inside Capacitor 8, built into an APK by the Android workflow. Native-only code is in `src/app/native/`, loaded with dynamic imports and left out of the website build; the app's three small plugins (share target, page fetch, haptics) are Java in `android/`.
- Local data: IndexedDB via Dexie.
- Sync: end-to-end encrypted events on public Nostr relays, behind a `Transport` interface so another backend can replace relays. See `PROTOCOL.md`.
- Design system: see `DESIGN.md`.

Code layout:

| Path | Contents |
|---|---|
| `src/core/` | Framework-free TypeScript: model, crypto, protocol, transports, database, services |
| `src/ui/` | Design system: tokens, styles, components |
| `src/app/` | Screens, routing, hooks that bind `core` to `ui`; `src/app/native/` for the Android app |
| `android/` | The Capacitor Android project |
| `e2e/` | Playwright end-to-end tests |
| `docs/` | This document, protocol, design system |

## 7. Milestones

| # | Scope | Status |
|---|---|---|
| M0 | Relay acceptance test | Done: 4 of 8 public relays tried accepted and returned an encrypted kind-30078 event; long-term retention not yet measured |
| M1 | Private wishlist, installable PWA, Pages deploy | Done |
| M2 | Shared lists: publish, link, giver view | Done |
| M3 | Claims, pledges, conflicts, owner-side hiding, device clock correction | Done |
| M4 | Share target, deep link, bookmarklet, iOS Shortcut recipe | Done; the Shortcut recipe has not been checked on every iOS version |
| M5 | Recovery code, multi-device sync, optional self-hosted relay | Planned |
| M6 | Android app: Capacitor shell, share target, on-device page reading, system bars, back, haptics, signed APK on Releases | Built; the APK compiles. The workflow's emulator check and behaviour on real phones are not yet confirmed |
| M5a | Weekly relay health check (`relay-health` workflow) with 1, 4 and 12 week retention probes | Done; needs several months of runs before retention numbers mean anything |
