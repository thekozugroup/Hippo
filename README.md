# Hippo

A private gift registry with no server, named after "I Want a Hippopotamus for Christmas".

Keep one private wishlist. Link items from it into shared lists for each occasion. Send a list to family and friends as a link. They mark items as taken or chip in toward larger ones, and you see none of it until they tell you.

- No accounts. No sign-up for you or for the people you share with.
- No backend. Hippo is a static web app. Your wishlist lives on your device.
- End-to-end encrypted sharing. Shared lists and claims are stored as ciphertext on public relays; the key is in the link you send.
- Installable. Add it to your home screen and share product pages to it from other apps (Android and desktop Chromium; see below for iOS).
- MIT licensed.

## How it works

| Piece | What it does |
|---|---|
| Static PWA (React, TypeScript, Vite) | The whole app. Hosted on GitHub Pages or any static host. |
| IndexedDB on your device | Your private wishlist, categories and list settings. |
| Public Nostr relays | Store encrypted list content and encrypted claims so that people with the link can read and write them. Relays cannot read anything. |
| Share link | Carries the list's public key and decryption secret in the URL fragment, which browsers never send to a server. |

Details are in [`docs/PROTOCOL.md`](docs/PROTOCOL.md). Product scope is in [`docs/PRD.md`](docs/PRD.md). The design system is in [`docs/DESIGN.md`](docs/DESIGN.md).

## What stays private

| Who | Sees |
|---|---|
| Relay operators | Encrypted blobs, their size and timing, IP addresses |
| Anyone without the link | Nothing |
| People with the link | The list, and each other's claims and pledges (with a nickname only if the giver set one) |
| You, the list owner | Your list. Not claims or pledges: the app hides them (see below). |

One limit to know about: hiding claims from the owner is enforced by the app, not by cryptography. You created the link, so you could open it in another browser and peek. Hippo will not show you, but it cannot stop you.

Hippo records pledges; it does not move money. Givers settle up among themselves.

## Run your own copy

1. Fork this repository.
2. In the fork, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or run the "Deploy to GitHub Pages" workflow by hand).

There is nothing to configure: no environment variables, no secrets, no database. The build uses relative asset paths, so it works at `https://<you>.github.io/<repo>/` and on a custom domain alike.

### Security notes

- **Give Hippo an origin of its own.** Browsers share storage (IndexedDB, localStorage, service workers) per origin, which is scheme, host and port, not per path. Hippo keeps every list's private keys and secrets in IndexedDB, so any other site on the same origin can read them and act as you. On GitHub Pages, all project sites of one account or organisation share `https://<you>.github.io`. Use a custom domain, or an account or organisation with no other Pages sites.
- **Your backup file holds every key.** Store it like a password. Importing someone else's file can add their lists; it never replaces the keys, owner key or relays of lists already on your device.
- **Share links only name public relays.** Links that point at `ws://`, `localhost`, `.local` names or private-network addresses are refused. The `?relays=` developer override accepts loopback relays only, lasts for one browser tab, and the app shows a notice while it is on.
- **Changing a link (rotation) or deleting a list** keeps the old keys on your device until the relays have accepted the "no longer shared" notice for the old link. Hippo retries this, and any list change no relay has accepted yet, at start, when the device comes back online, when the app comes back to the foreground, and every few minutes while something is waiting.
- **Content-Security-Policy is set by a `<meta>` tag**, because GitHub Pages cannot send custom headers. A meta-tag policy cannot set `frame-ancestors`, so it does not stop other sites from framing Hippo. If you host Hippo where you control headers, also send `Content-Security-Policy: frame-ancestors 'none'`. The policy allows plain `ws:` only for loopback addresses (the developer relay override), so test and production builds are identical. `require-trusted-types-for 'script'` is not set: with it, Chromium blocks the service worker registration (a `TrustedScriptURL` sink) unless a Trusted Types policy is added.
- **Removing a list shared with you** hides it on this device but keeps your guest key, so opening the link again lets you change or take back what you said you would get. Backups include hidden lists.

## Develop

Requires Node 22 or newer.

```
npm install
npm run dev        # start the dev server
npm test           # unit and integration tests
npm run lint
npm run typecheck
npm run build      # production build in dist/
```

Source layout:

| Path | Contents |
|---|---|
| `src/core/` | Framework-free TypeScript: data model, crypto, protocol, transports, database, services |
| `src/ui/` | Design system: tokens, styles, components |
| `src/app/` | Screens and routing |
| `e2e/` | Playwright end-to-end tests |

## Adding items from your phone

- Android, and desktop Chrome or Edge: install Hippo, then use the system share sheet from any browser or shopping app and pick Hippo.
- iOS: Safari does not let web apps appear in the share sheet. Use the Shortcut recipe or paste the link into Hippo. Both are described in the app under Settings.
- Desktop: use the bookmarklet from Settings.

## Status

Early. The relay-based sync has been checked for acceptance on several public relays but not yet for long-term retention. Back up your wishlist with the export function in Settings.

## License

[MIT](LICENSE)
