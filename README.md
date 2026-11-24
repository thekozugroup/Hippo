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

**A static host** hosts the app. [Vercel](#run-your-own-copy) (recommended) and GitHub Pages both work. The app is a set of files (web pages and scripts) that the host hands to any browser that asks. The host does not run any code for you and never sees your wishlist.

**Relays** are public servers that anyone can run, used by a system called Nostr. A relay accepts small messages, stores them for a while and gives them to anyone who asks for them by name. Hippo uses relays as a shared mailbox. When you share a list, Hippo scrambles it (encrypts it) on your device and puts the scrambled message on several relays. When a friend opens your link, their browser asks the relays for the message and unscrambles it with a key that is part of the link. The relays only ever hold scrambled data, so they cannot read your list or the claims. When a friend marks a gift as taken, their browser puts another scrambled message on the same relays.

Relays are run by volunteers and may be slow, go offline or delete old messages. Hippo therefore sends everything to several relays at once. It also keeps a copy on your device and sends it again when a relay has lost it.

| Piece | What it does |
|---|---|
| Static web app (React, TypeScript, Vite) | The whole app. Hosted on Vercel, GitHub Pages or any static host. |
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

Your data stays on the phone, in the app's own storage, separate from the browser's. To move wishes between them, use Export backup in one and Import backup in the other, or Settings, Move Hippo to another device, which makes a link that works for 15 minutes (open it in the other one, or paste it under Enter a transfer link). Both then hold the same lists; Hippo does not keep them in step afterwards. The first setup screen also has "I already use Hippo" for this.

**Use my own Hippo site.** Links made in the app point at the website it was built for. Under Settings, Hippo site (or "I already use Hippo" in setup) you can enter another Hippo website, for example your own copy or a site that moved to its own domain. [Connect the Android app to your site](#connect-the-android-app-to-your-site) has the steps. The app fetches the site's `hippo.json` (every website build publishes it at its root) through its own hardened fetch, checks that it is a compatible Hippo site, shows the host it connected to, and from then on builds share and transfer links on it and uses its relays unless you set your own. Before it shows a list link, the app checks once per session that the site answers; if it does not, a line beside the link says the link will not open for other people yet. Sharing still works. Android's cloud backup leaves Hippo's data out, because it holds the keys of your shared lists. Use Export backup.

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

**The site address.** `HIPPO_SITE_URL` is the public website that share links made in the app point at. The build stops without it. The Android workflow uses this repository's GitHub Pages address; set a repository variable named `HIPPO_SITE_URL` (Settings, Secrets and variables, Actions, Variables) to use a custom domain such as your Vercel address. You can also build the app with its address left at the default and change it later in the app, under Settings, Hippo site. Choose it before you share lists from the app, because the links contain it.

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

Never commit the keystore. Run **Actions, Android app, Run workflow** to build an APK (it is under the run's Artifacts), or push a tag such as `v0.2.0` to attach it to a GitHub Release. Without the secrets the workflow builds a debug APK and says so in the run summary. Each run also starts the APK on an Android 15 emulator (`scripts/android-emulator-smoke.sh`) and measures it inside the real WebView, with Playwright attached over adb (`scripts/android-webview-checks.mjs`; debug builds allow WebView debugging, release builds do not): the logo intro ends small in its header; the page is drawn edge to edge under the transparent status and navigation bars, with the insets the layout uses matching the system bar sizes and no colour step at either bar's edge in the screenshot; the WebView ends at the top of the on-screen keyboard; on Home the fade layer and dark status bar icons appear once the sheet is under the status bar; and the setup slide control works by real swipe and tap. Each check writes a PASS or FAIL line with its numbers to the run summary, and the screenshots are in the run's `emulator-smoke` artifact.

The application id is `io.github.thekozugroup.hippo`. A fork that publishes its own app should change it (in `capacitor.config.ts` and `android/app/build.gradle`) before its first release; it cannot change afterwards without losing updates in place.

## Run your own copy

You can put your own copy of Hippo online for free and point the Android app at it. People you share lists with then open them on your address, for example `hippo.example.com`. You do not need to install anything or write code.

| | Vercel (recommended) | GitHub Pages |
|---|---|---|
| Effort | One button, about two minutes | About 20 minutes of steps |
| Address of its own | Yes, every project has its own | Only with an organisation or a custom domain |
| Security headers (blocks framing, and more) | Yes, sent by the host | No, GitHub Pages cannot send them |
| Updates | You pull them in (see below) | You pull them in |
| Cost | Free for personal use | Free |

Vercel is recommended because the copy gets its own address, the host sends real security headers, and the setup is one click. GitHub Pages stays supported; its steps are [further down](#alternative-github-pages).

### Put Hippo online with Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fthekozugroup%2FHippo&project-name=hippo&repository-name=hippo)

You need a GitHub account (free). If you do not have one, make one first at <https://github.com/signup>.

1. Press the **Deploy with Vercel** button above. Vercel's page opens.
2. Choose **Continue with GitHub** and sign in. A new Vercel account is free; it starts on Vercel's Hobby plan. Allow Vercel to use your GitHub account when it asks.
3. Vercel asks where to put your copy of the project. Pick your GitHub account. The name `hippo` is already filled in; change it if you like. Leave the other boxes as they are and press **Create**.
4. Vercel makes your own copy of Hippo in your GitHub account, builds it and puts it online. This takes about a minute. There is nothing to fill in: no settings, no secrets, no database.
5. When it finishes, Vercel shows a preview of the site. Press it, or press **Continue to Dashboard** and then **Visit**. The address looks like `hippo-xxxx.vercel.app`. That is your Hippo. Open it in a browser and go through setup.

GitHub may show a failed run of **Deploy to GitHub Pages** in your copy, because that workflow is for the other route. It does no harm. To stop it, open **Actions**, choose **Deploy to GitHub Pages**, open the three-dot menu and choose **Disable workflow**.

#### Give it your own address

Do this if you want an address like `hippo.example.com`. You need a domain name from a registrar. Buying one costs money; adding it to Vercel does not.

1. In Vercel, open your project. Choose **Settings**, then **Domains**, then **Add Existing**.
2. Type the address, for example `hippo.example.com`, and confirm.
3. Vercel shows one DNS record to add: a `CNAME` record. The name is the first part of your address (`hippo`) and the value is a long address that Vercel shows you, such as `d1d4fc829fe7bc7c.vercel-dns-017.com`. Copy the value from Vercel, not from here.
4. In your registrar's DNS settings, add that `CNAME` record and save. Vercel's page shows **Valid Configuration** when it has found the record. This can take from a few minutes to an hour.
5. Open **Deployments**, open the menu next to the latest one and choose **Redeploy**. Hippo reads its address when it is built, so the redeploy puts your new address into link previews. Hippo works on the new address before this, but previews would still show the old one.

If you use an apex domain such as `example.com`, Vercel asks for an `A` record instead.

#### Updates

A copy made with the button is not linked to the original, and nothing is pulled in on its own. When you push a change to your copy's `main` branch, Vercel builds and publishes it by itself. It does not look at the original project.

To take a newer version of Hippo into your copy, run this on your computer:

```
git clone https://github.com/<you>/hippo
cd hippo
git remote add upstream https://github.com/thekozugroup/Hippo.git
git fetch upstream
git merge upstream/main
git push
```

If Git says the histories are unrelated, add `--allow-unrelated-histories` to the merge. For one-button updates instead, fork the project on GitHub (the **Fork** button on the original page), then in Vercel choose **Add New**, **Project**, and import your fork. GitHub then shows **Sync fork** on your copy, and Vercel publishes each sync.

#### What it costs

Vercel's free Hobby plan is for personal, non-commercial use. It includes 100 GB of data transfer and 1,000,000 requests a month, which a gift list for family and friends is unlikely to reach, and a custom domain can be added on it (up to 50 per project). The terms are at <https://vercel.com/legal/terms> and the plan limits at <https://vercel.com/docs/plans/hobby>.

#### What Hippo sets up for you

The project has a `vercel.json`, so Vercel needs no settings. It builds the normal website (`npm run build`), serves `dist/` at the top of your address and sends these headers:

| Header | Value |
|---|---|
| `Content-Security-Policy` | The same policy as the page's `<meta>` tag, plus `frame-ancestors 'none'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | Turns off camera, microphone, location, payment, USB, Bluetooth, serial, HID, motion sensors and the topics API |
| `Cache-Control` | Files in `assets/` are cached for a year, because their names change with each build. `sw.js`, `manifest.webmanifest` and `hippo.json` are always checked again. |

The site's public address is taken from Vercel's production address (`VERCEL_PROJECT_PRODUCTION_URL`) when the build is the production one, so link previews and `hippo.json` carry it. To use another address, set `HIPPO_SITE_URL` under **Settings**, **Environment Variables** in Vercel. Preview builds, made for branches, never name themselves as the site. If you change the policy in `vite.config.ts`, change it in `vercel.json` too. A test fails when they differ.

### Connect the Android app to your site

The Android app builds links that other people open in a browser, so it needs the address of a Hippo site that answers. It starts with the one it was built for. To use yours:

1. Open the app. On the first setup screen choose **I already use Hippo**, then **Use my own Hippo site**. Later, the same screen is under **Settings**, **Hippo site**.
2. Choose **I have a Hippo site** and type the address, for example `hippo.example.com`. You can leave out `https://`.
3. Press **Check and use**. Hippo reads `hippo.json` from your site, checks that it is a compatible Hippo, and shows the address it connected to. From then on, links you share use it.

The first time you share a list, if the built-in address does not answer, the app shows these same choices before the link. **Set one up, free, about two minutes** opens the Vercel page above in the phone's browser. When your copy is online, come back and type its address. **Share anyway** skips this, and the link then carries a note that it will not open for other people yet. Lists you shared before keep the address they were made with.

### Alternative: GitHub Pages

Use this if you prefer not to use Vercel. It takes more steps, and GitHub Pages cannot send security headers, so Hippo relies on its own checks (see the security notes). You need a free GitHub account and about 20 minutes.

#### 1. Make an organisation for Hippo

Your browser keeps Hippo's private keys per web address. On GitHub Pages, every site of one account shares the address `<you>.github.io`, so another site of yours could read Hippo's keys. Give Hippo an address of its own. The free way:

1. On GitHub, open **+ → New organization**, choose the **Free** plan, and pick a name. The name becomes your address: `<name>.github.io`.
2. Do not publish any other Pages site from this organisation.

If you would rather use your own domain, skip this step and do step 5 instead. If you do neither, Hippo still works, and the deployment checks will warn you.

#### 2. Fork the repository

1. Open the Hippo repository on GitHub and choose **Fork**.
2. Under **Owner**, pick the organisation from step 1.
3. Name the fork `<name>.github.io`, with `<name>` exactly as the organisation is called. This name makes GitHub publish the site at `https://<name>.github.io/`, with no sub-path. If you already forked it with another name, rename it under **Settings → General → Repository name**.

#### 3. Turn on GitHub Pages

1. In the fork, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

#### 4. Publish

1. Open the **Actions** tab. If GitHub asks, choose to enable workflows.
2. Open **Deploy to GitHub Pages** and choose **Run workflow**. A push to `main` does the same.
3. Wait for the run to turn green (about 5 minutes). Open `https://<name>.github.io/`.
4. Back in **Settings → Pages**, tick **Enforce HTTPS** if it is offered.

There is nothing to configure: no secrets, no database. The workflow passes your site's address to the build, so links you paste in chats show a preview card with a picture. A build without it still works, and the card then has no picture.

#### 5. Optional: use your own domain instead

1. Buy a domain from any registrar.
2. In the registrar's DNS settings, add a `CNAME` record from the name you want (for example `gifts.example.org`) to `<name>.github.io`, where `<name>` is the account or organisation that owns the fork.
3. In **Settings → Pages**, enter the domain under **Custom domain** and save. Tick **Enforce HTTPS** once it appears (this can take up to an hour).

Share links contain the web address, so choose your final address before you share lists. Lists shared from another address keep working only while that address stays online.

### Check the result

Open your site, go to **Settings**, scroll to the bottom and open **Deployment checks**. Each check is one line; a check that is not fine is marked **Needs attention** (or **Could not check**) and says what to do. **Check again** runs them again.

| Check | What it tells you |
|---|---|
| HTTPS | The page is served over a secure connection. |
| Own address | No other site shares Hippo's browser storage. Warns on `github.io` sub-paths. |
| Not framed | Hippo is not shown inside another site. It also says whether the host sends a header that forbids framing (Vercel does; GitHub Pages cannot). |
| Service worker | Hippo can open offline. Reload once if it says "not controlling". |
| Storage | The browser can store data, and has promised not to delete it. |
| Relays | How many of the configured relays answered a test connection. |

"Unknown" means the browser did not give an answer. It does not mean something is wrong. In the Android app the address, service worker and storage checks are left out, because they are about a browser tab.

### Watch the relays

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

- **Give Hippo an origin of its own.** Browsers share storage (IndexedDB, localStorage, service workers) per origin, which is scheme, host and port, not per path. Hippo keeps every list's private keys and secrets in IndexedDB, so any other site on the same origin can read them and act as you. On GitHub Pages, all project sites of one account or organisation share `https://<you>.github.io`. On Vercel every project has its own address, so this is met by default. On GitHub Pages, use a custom domain or an organisation whose only Pages site is Hippo (steps 1 and 2).
- **Your backup file holds every key.** Store it like a password. Importing someone else's file can add their lists; it never replaces the keys, owner key or relays of lists already on your device.
- **Share links only name public relays.** Links that point at `ws://`, `localhost`, `.local` names or private-network addresses are refused. The `?relays=` developer override accepts loopback relays only, lasts for one browser tab, and the app shows a notice while it is on.
- **Changing a link (rotation) or deleting a list** keeps the old keys on your device until the relays have accepted the "no longer shared" notice for the old link. Hippo retries this, and any list change no relay has accepted yet, at start, when the device comes back online, when the app comes back to the foreground, and every few minutes while something is waiting.
- **Framing.** On Vercel, Hippo sends `Content-Security-Policy` with `frame-ancestors 'none'` and `X-Frame-Options: DENY` as real headers, and the browser refuses to show it inside another site. GitHub Pages cannot send them, and a policy set in a `<meta>` tag cannot include `frame-ancestors`. So on every host Hippo also checks for itself: if it is shown inside another site's frame, it starts nothing and shows a message with a link that opens Hippo in its own tab. If you host Hippo anywhere else that lets you set headers, also send `Content-Security-Policy: frame-ancestors 'none'`.
- **Device clocks.** Claims are ordered by time, and a device whose clock is wrong would disagree with everyone else about who is getting a gift. Hippo measures the device clock against the `Date` header of a request to its own address (never a third party) and uses the corrected time; it tells the person once when the clock is more than about two minutes off. Without an answer (offline on a first visit) it uses the device clock.
- **Content-Security-Policy is set by a `<meta>` tag**, because GitHub Pages cannot send custom headers. On Vercel the same policy is also sent as a header (`vercel.json`), with `frame-ancestors 'none'` added. Vercel also sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a `Permissions-Policy` that turns off features Hippo does not use. It does not send `Cross-Origin-Opener-Policy`: that header only matters for sites that open pop-ups which talk back to the page, which Hippo does not do, and the system share sheet and install prompt cannot be tested for it from here. The policy allows plain `ws:` only for loopback addresses (the developer relay override), so test and production builds are identical. `require-trusted-types-for 'script'` is not set: with it, Chromium blocks the service worker registration (a `TrustedScriptURL` sink) unless a Trusted Types policy is added.
- **Link lookup is off by default.** If you turn on **Link lookup** in Settings, Hippo sends the link of each wish you add to Microlink (`api.microlink.io`), a third-party service, so it can look up the page's title and picture. Only the link is sent, after tracking parameters and the part after `#` are removed, and only for `https` links to public sites. Microlink sees the link and your IP address, as any web server would. Nothing is sent to it while the setting is off. Besides the relays and Hippo's own address, the content policy allows two kinds of outside requests: this one host, and pictures over `https` from any host, because a wish's picture can come from any shop (PRD FR-28).
- **Android app.** The app asks for one permission, Internet. Its content policy is the website's without the parts it does not use (no service worker, no manifest, no Microlink). WebView debugging is off in release builds, and Capacitor's logging is off in every build, so share links and shared text never reach the device log. Reading a shop page fetches only `https` pages on public hosts, checks every redirect and every address the host name resolves to (no loopback, private, link-local or reserved ranges), stops after 8 seconds and 1.5 MB, sends no cookies, and reads only HTML. The page is parsed without running it, and only the name, picture and price are kept, validated like any other input. One limit: a host that gives a different DNS answer to the check and to the connection is not caught. Android's cloud backup and device-to-device transfer leave Hippo's data out.
- **Moving to another device with a transfer link** (Settings, Move Hippo to another device) sends everything a backup file holds, encrypted with a random key that exists only in the link, to the same public relays as your lists, where it expires after 15 minutes. **Anyone who gets the link in those 15 minutes can copy your wishlist and the keys to your lists**, so send it only to yourself. The receiving device checks every part (signature, order, length, a hash of the whole) and the backup inside with the same validation as a backup file, shows what it found and writes nothing until you confirm; it merges and never replaces lists already there. Once it has the data it asks the relays to delete the parts and overwrites them, so the link cannot be used again; Cancel transfer does the same. Backups larger than 2 MB after compression must be moved with a file. Details: `docs/PROTOCOL.md` section 11.
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
