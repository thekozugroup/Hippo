# Hippo

A private gift registry with no server, named after "I Want a Hippopotamus for Christmas".

Keep one private wishlist. Link items from it into shared lists for each occasion. Send a list to family and friends as a link. They mark items as taken or chip in toward larger ones, and you see none of it until they tell you.

- No accounts. No sign-up for you or for the people you share with.
- No backend. Hippo is a static web app. Your wishlist lives on your device.
- End-to-end encrypted sharing. Shared lists and claims are stored as ciphertext on public relays; the key is in the link you send.
- Installable. Your browser installs Hippo as an app with its own icon. Setup shows the steps for your phone or computer, and Settings has them under Install Hippo. On Android there is also an app (see [Android app](#android-app)), built from the same code.
- MIT licensed.

## How it works

Hippo has no server of its own. Two free public services do the work.

**GitHub Pages** hosts the app. It is a set of files (web pages and scripts) that GitHub hands to any browser that asks. GitHub does not run any code for you and never sees your wishlist.

**Relays** are public servers that anyone can run, used by a system called Nostr. A relay accepts small messages, stores them for a while and gives them to anyone who asks for them by name. Hippo uses relays as a shared mailbox. When you share a list, Hippo scrambles it (encrypts it) on your device and puts the scrambled message on several relays. When a friend opens your link, their browser asks the relays for the message and unscrambles it with a key that is part of the link. The relays only ever hold scrambled data, so they cannot read your list or the claims. When a friend marks a gift as taken, their browser puts another scrambled message on the same relays.

Relays are run by volunteers and may be slow, go offline or delete old messages. Hippo therefore sends everything to several relays at once. It also keeps a copy on your device and sends it again when a relay has lost it.

| Piece | What it does |
|---|---|
| Static web app (React, TypeScript, Vite) | The whole app. Hosted on GitHub Pages or any static host. |
| IndexedDB on your device | Your private wishlist, categories and list settings. |
| Public Nostr relays | Store encrypted list content and encrypted claims so that people with the link can read and write them. |
| Share link | Carries the list's public key and decryption secret in the part of the address after `#`, which browsers never send to a server. |

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

## Android app

Hippo also comes as an Android app. It is the same app as the website, inside a native Android shell, with its files in the APK. Lists you share from it open on the website, so family and friends still need only a browser.

What the app adds:

- Hippo is in Android's share sheet from the start. In a shop or browser, tap Share, then Hippo, and Add a wish opens with the link.
- It reads the name, picture and price of a shop page itself, on your phone, and fills the fields you left empty. Nothing is sent to anyone else. You can turn this off in Settings, under Shop pages.
- The Back button and the back gesture close an open sheet first, then go back.
- It draws under the status and navigation bars, has a splash screen and its own icon, and gives light haptic feedback when a gift is marked, a switch is turned or a deletion is confirmed (not under reduced motion, and not when touch feedback is off in Android settings).
- Share buttons open Android's share sheet, and Export backup saves the file through it (to Files, Drive or email).

Your data stays on the phone, in the app's own storage, separate from the browser's. To move wishes between them, use Export backup in one and Import backup in the other. Android's cloud backup leaves Hippo's data out, because it holds the keys of your shared lists. Use Export backup.

### Get the APK

1. Open the repository's **Releases** page and download `hippo-<version>.apk` under **Assets**.
2. Open the file on the phone. Allow installing from that source when Android asks.

A file named `...-debug-temporary-key.apk` was built without the signing key. It works, but a later APK cannot update it: export a backup, uninstall it, then install the new one.

Links to the website open in the browser. To open them in the app instead, go to **App info, Open by default, Add link** and tick the website. Android only does this on its own for sites that publish a verification file at the root of their domain, which a GitHub Pages project site cannot do. Inside the app, **Lists** also has **Open a list from a link**, where you can paste a link.

### Build it yourself

You need Node 22, JDK 21 and the Android SDK with platform 36 (Android Studio installs it).

```
export ANDROID_HOME=$HOME/Android/Sdk
export HIPPO_SITE_URL=https://<owner>.github.io/<repo>/
npm run android:apk    # android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run android:sync` builds the web app for the app (into `dist-native/`) and copies it into `android/`. Open `android/` in Android Studio to run it on a phone. `npm run icons:android` draws the launcher icon and the splash mark again from the hippo glyph.

**The site address.** `HIPPO_SITE_URL` is the public website that share links made in the app point at. The build stops without it. The Android workflow uses this repository's GitHub Pages address; set a repository variable named `HIPPO_SITE_URL` (Settings, Secrets and variables, Actions, Variables) to use a custom domain. Choose it before you share lists from the app, because the links contain it.

### Signing

Android updates an installed app only with an APK signed by the same key. Make the key once and keep it safe; if it is lost, everyone has to uninstall to update.

```
keytool -genkeypair -v -keystore hippo-release.jks -alias hippo -keyalg RSA -keysize 4096 -validity 10000
```

Then add four repository secrets (Settings, Secrets and variables, Actions):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | The output of `base64 -w0 hippo-release.jks` (macOS: `base64 -i hippo-release.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password you chose |
| `ANDROID_KEY_ALIAS` | `hippo` |
| `ANDROID_KEY_PASSWORD` | The key password (the same as the keystore password unless you chose another) |

Never commit the keystore. Run **Actions, Android app, Run workflow** to build an APK (it is under the run's Artifacts), or push a tag such as `v0.2.0` to attach it to a GitHub Release. Without the secrets the workflow builds a debug APK and says so in the run summary. Each run also starts the APK on an emulator and fails if Hippo's first screen does not appear.

The application id is `io.github.thekozugroup.hippo`. A fork that publishes its own app should change it (in `capacitor.config.ts` and `android/app/build.gradle`) before its first release; it cannot change afterwards without losing updates in place.

## Run your own copy

You need a free GitHub account and about 20 minutes. You do not need to install anything or write code.

### 1. Make an organisation for Hippo

Your browser keeps Hippo's private keys per web address. On GitHub Pages, every site of one account shares the address `<you>.github.io`, so another site of yours could read Hippo's keys. Give Hippo an address of its own. The free way:

1. On GitHub, open **+ → New organization**, choose the **Free** plan, and pick a name. The name becomes your address: `<name>.github.io`.
2. Do not publish any other Pages site from this organisation.

If you would rather use your own domain, skip this step and do step 5 instead. If you do neither, Hippo still works, and the deployment checks (step 6) will warn you.

### 2. Fork the repository

1. Open the Hippo repository on GitHub and choose **Fork**.
2. Under **Owner**, pick the organisation from step 1.
3. Name the fork `<name>.github.io`, with `<name>` exactly as the organisation is called. This name makes GitHub publish the site at `https://<name>.github.io/`, with no sub-path. If you already forked it with another name, rename it under **Settings → General → Repository name**.

### 3. Turn on GitHub Pages

1. In the fork, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

### 4. Publish

1. Open the **Actions** tab. If GitHub asks, choose to enable workflows.
2. Open **Deploy to GitHub Pages** and choose **Run workflow**. A push to `main` does the same.
3. Wait for the run to turn green (about 5 minutes). Open `https://<name>.github.io/`.
4. Back in **Settings → Pages**, tick **Enforce HTTPS** if it is offered.

There is nothing to configure: no secrets, no database. The workflow passes your site's address to the build, so links you paste in chats show a preview card with a picture; a build without it still works, and the card then has no picture.

### 5. Optional: use your own domain instead

1. Buy a domain from any registrar.
2. In the registrar's DNS settings, add a `CNAME` record from the name you want (for example `gifts.example.org`) to `<name>.github.io`, where `<name>` is the account or organisation that owns the fork.
3. In **Settings → Pages**, enter the domain under **Custom domain** and save. Tick **Enforce HTTPS** once it appears (this can take up to an hour).

Share links contain the web address, so choose your final address before you share lists. Lists shared from another address keep working only while that address stays online.

### 6. Check the result

Open your site, go to **Settings**, scroll to the bottom and open **Deployment checks**. Each check is one line; a check that is not fine is marked **Needs attention** (or **Could not check**) and says what to do. **Check again** runs them again.

| Check | What it tells you |
|---|---|
| HTTPS | The page is served over a secure connection. |
| Own address | No other site shares Hippo's browser storage. Warns on `github.io` sub-paths. |
| Not framed | Hippo is not shown inside another site. |
| Service worker | Hippo can open offline. Reload once if it says "not controlling". |
| Storage | The browser can store data, and has promised not to delete it. |
| Relays | How many of the configured relays answered a test connection. |

"Unknown" means the browser did not give an answer. It does not mean something is wrong. In the Android app the address, service worker and storage checks are left out, because they are about a browser tab.

### 7. Watch the relays

Relays come and go. The repository contains a weekly check, the **Relay health** workflow, which starts on its own every Monday. It does this for each default relay:

1. It sends one small test message that looks like Hippo traffic.
2. It asks for the message back.
3. It looks for the test messages of 1, 4 and 12 weeks ago, to see whether the relay keeps data for as long as Hippo needs.

The result is a table in the run's summary on the **Actions** tab. The run fails, and GitHub emails the repository owner, when fewer than three relays both accept and return the test message. Run it by hand with **Actions → Relay health → Run workflow**, or on your computer with `npm run relay-health` (Node 22.18 or newer). A "weeks ago" column reads "no" until the script has been running for that many weeks.

GitHub switches off scheduled workflows after 60 days without any activity in the repository. If the weekly emails stop, run the workflow once by hand.

**When it fails:**

1. Open the failed run and read the table. Note which relays show "no" under Reachable or Accepted.
2. Find replacement relays. A list of public relays is at <https://nostr.watch>. Choose ones that accept writes without payment or login.
3. Edit `DEFAULT_RELAYS` in `src/core/config.ts`: remove the dead relays and add working ones. Keep any relay that still works. Share links made with the default relays look on whatever `DEFAULT_RELAYS` contains at that moment, so removing a working relay can hide lists stored only there.
4. Commit to `main`. The site is rebuilt and published. Run **Relay health** again to confirm.

### Security notes

- **Give Hippo an origin of its own.** Browsers share storage (IndexedDB, localStorage, service workers) per origin, which is scheme, host and port, not per path. Hippo keeps every list's private keys and secrets in IndexedDB, so any other site on the same origin can read them and act as you. On GitHub Pages, all project sites of one account or organisation share `https://<you>.github.io`. Use a custom domain, or an organisation whose only Pages site is Hippo (steps 1 and 2).
- **Your backup file holds every key.** Store it like a password. Importing someone else's file can add their lists; it never replaces the keys, owner key or relays of lists already on your device.
- **Share links only name public relays.** Links that point at `ws://`, `localhost`, `.local` names or private-network addresses are refused. The `?relays=` developer override accepts loopback relays only, lasts for one browser tab, and the app shows a notice while it is on.
- **Changing a link (rotation) or deleting a list** keeps the old keys on your device until the relays have accepted the "no longer shared" notice for the old link. Hippo retries this, and any list change no relay has accepted yet, at start, when the device comes back online, when the app comes back to the foreground, and every few minutes while something is waiting.
- **Framing.** GitHub Pages cannot send the `frame-ancestors` header, and a policy set in a `<meta>` tag cannot include it. So Hippo checks for itself: if it is shown inside another site's frame, it starts nothing and shows a message with a link that opens Hippo in its own tab. If you host Hippo where you control headers, also send `Content-Security-Policy: frame-ancestors 'none'`.
- **Device clocks.** Claims are ordered by time, and a device whose clock is wrong would disagree with everyone else about who is getting a gift. Hippo measures the device clock against the `Date` header of a request to its own address (never a third party) and uses the corrected time; it tells the person once when the clock is more than about two minutes off. Without an answer (offline on a first visit) it uses the device clock.
- **Content-Security-Policy is set by a `<meta>` tag**, because GitHub Pages cannot send custom headers. The policy allows plain `ws:` only for loopback addresses (the developer relay override), so test and production builds are identical. `require-trusted-types-for 'script'` is not set: with it, Chromium blocks the service worker registration (a `TrustedScriptURL` sink) unless a Trusted Types policy is added.
- **Link lookup is off by default.** If you turn on **Link lookup** in Settings, Hippo sends the link of each wish you add to Microlink (`api.microlink.io`), a third-party service, so it can look up the page's title and picture. Only the link is sent, after tracking parameters and the part after `#` are removed, and only for `https` links to public sites. Microlink sees the link and your IP address, as any web server would. Nothing is sent to it while the setting is off. Besides the relays and Hippo's own address, the content policy allows two kinds of outside requests: this one host, and pictures over `https` from any host, because a wish's picture can come from any shop (PRD FR-28).
- **Android app.** The app asks for one permission, Internet. Its content policy is the website's without the parts it does not use (no service worker, no manifest, no Microlink). WebView debugging is off in release builds, and Capacitor's logging is off in every build, so share links and shared text never reach the device log. Reading a shop page fetches only `https` pages on public hosts, checks every redirect and every address the host name resolves to (no loopback, private, link-local or reserved ranges), stops after 8 seconds and 1.5 MB, sends no cookies, and reads only HTML. The page is parsed without running it, and only the name, picture and price are kept, validated like any other input. One limit: a host that gives a different DNS answer to the check and to the connection is not caught. Android's cloud backup and device-to-device transfer leave Hippo's data out.
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
npm run relay-health  # test the default relays (needs internet)
npm run android:apk   # Android debug APK (see Android app)
```

Source layout:

| Path | Contents |
|---|---|
| `src/core/` | Framework-free TypeScript: data model, crypto, protocol, transports, database, services |
| `src/ui/` | Design system: tokens, styles, components |
| `src/app/` | Screens and routing; `src/app/native/` holds everything specific to the Android app |
| `android/` | The Android project (Capacitor), with the app's small native plugins |
| `e2e/` | Playwright end-to-end tests |
| `scripts/` | Maintainer scripts: icons, the link preview picture (`node scripts/generate-og-image.mjs`), relay health check |

## Adding items

| Method | What you get | Third party involved |
|---|---|---|
| Bookmarklet (desktop) or Shortcut (iOS) | Title, link, picture and price, read from the page you are looking at | None |
| Share sheet (Android, with Hippo installed) | Title and link, whatever the sharing app provides | None |
| Pasting a link | A title guessed from the link | None |
| Pasting a link or using the share sheet, with Link lookup turned on | Title and picture looked up for you | Microlink, see security notes |
| Android app: the share sheet or a pasted link | Title, picture and price, read from the shop page by your phone | None |

The bookmarklet and the Shortcut run inside the page you are viewing, so they can read its picture and price. They hand these to Hippo in the address, and no other site is contacted. This is the method that works without any third party. A static site cannot read another site's page by itself, which is why the other methods need either the sharing app's help or the optional Link lookup.

- Android: install Hippo (setup shows how: "Install Hippo" when Chrome offers it, otherwise ⋮ then Add to home screen), then use the system share sheet from any browser or shopping app and pick Hippo.
- iPhone and iPad: add Hippo to the Home Screen from Safari (Share, then Add to Home Screen, then Add). Setup asks for this first, because the Home Screen app keeps its own copy of your wishes, separate from Safari's; to move wishes added in Safari, export a backup there and import it in the app. Web apps do not appear in the iOS share sheet, so use the Shortcut recipe or paste the link into Hippo. Both are described in the app under Settings.
- Computer: install Hippo from Chrome or Edge, or add it to the Dock from Safari (File, Add to Dock), and use the bookmarklet from Settings to add the page you are looking at.

## Status

Early. The relay-based sync has been checked for acceptance on several public relays. Long-term retention is being measured by the weekly Relay health check; there are not yet enough weeks of results to say how long relays keep data. Back up your wishlist with the export function in Settings.

## License

[MIT](LICENSE)
