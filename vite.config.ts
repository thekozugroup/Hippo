/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** The Vite mode that builds the web assets for the Android app (Capacitor's webDir is NATIVE_OUT_DIR). */
export const NATIVE_MODE = 'native'
export const NATIVE_OUT_DIR = 'dist-native'

// Hero-top blue from the design tokens (--blue-800); also the splash colour.
const THEME_COLOR = '#1e3a8a'

/**
 * Strict Content-Security-Policy for the built app. Only what Hippo needs:
 * its own files, relays over wss:, item pictures over https:, and data: for
 * the inline SVG film grain in the CSS. Plain ws: is allowed for loopback
 * only (the developer relay override, PROTOCOL.md section 7), so the
 * production build and the end-to-end build are the same. No inline scripts
 * or inline <style>; React's `style` props go through the CSSOM, which
 * style-src does not restrict. Injected at build time only, because Vite's
 * dev server relies on inline scripts and styles. A meta-tag CSP cannot set
 * frame-ancestors (see README, security notes).
 */
// The one third-party host the app may call over https: the opt-in link preview
// lookup (src/core/services/link-preview.ts, LINK_PREVIEW_HOST). It is off
// unless the user turns it on in Settings. Keep this in step with that constant.
const LINK_PREVIEW_ORIGIN = 'https://api.microlink.io'

/** Directives shared by the website and the Android app. */
const CSP_COMMON = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https: data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
]

const CSP = [
  ...CSP_COMMON,
  `connect-src 'self' wss: ${LINK_PREVIEW_ORIGIN} ws://127.0.0.1:* ws://localhost:*`,
  "manifest-src 'self'",
  "worker-src 'self'",
].join('; ')

/**
 * The Android app's policy: the same as the website's, minus what the app does not use. Its files
 * come from the APK through Capacitor's local server (https://localhost, so 'self'). There is no
 * manifest and no service worker, and Microlink is not offered, so those are closed. Capacitor's
 * bridge script is added by the WebView before the page's own scripts run (or, on old WebViews,
 * inserted ahead of this tag, where a meta policy does not reach), and native calls (HTTP, share,
 * files) go through the bridge, not through fetch, so connect-src needs nothing for them.
 */
const NATIVE_CSP = [
  ...CSP_COMMON,
  "connect-src 'self' wss: ws://127.0.0.1:* ws://localhost:*",
  "manifest-src 'none'",
  "worker-src 'none'",
].join('; ')

function contentSecurityPolicy(policy: string): Plugin {
  return {
    name: 'hippo-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html
          .replace(/<meta charset="UTF-8" \/>/i, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
          // Render-blocking entry: the browser paints nothing before main.tsx has decided the first
          // screen (src/app/core/boot.ts), so a first visit never shows a light frame before setup.
          .replace(/<script type="module" crossorigin src=/, '<script type="module" crossorigin blocking="render" src='),
    },
  }
}

/**
 * Link previews need absolute URLs for og:image and og:url. The deploy workflow passes the Pages
 * address (the configure-pages step's base_url) as HIPPO_SITE_URL; without it (local builds,
 * forks that have not set it) those two tags are left out and the card shows without a picture.
 */
export function siteUrlFromEnv(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return undefined
    return u.href.endsWith('/') ? u.href : `${u.href}/`
  } catch {
    return undefined
  }
}

/** Android app build: writes the site address next to index.html, so the Android build (app/build.gradle) uses the same one. */
function siteAddressFile(site: string): Plugin {
  return {
    name: 'hippo-site-address',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'hippo-site-url.txt', source: `${site}\n` })
    },
  }
}

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function openGraphUrls(site: string | undefined): Plugin {
  return {
    name: 'hippo-og-urls',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        site
          ? html.replace(
              /<meta name="twitter:card"[^>]*\/>/,
              (m) =>
                `<meta property="og:url" content="${escapeAttr(site)}" />\n    <meta property="og:image" content="${escapeAttr(`${site}og-image.png`)}" />\n    <meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="630" />\n    <meta property="og:image:alt" content="The Hippo logo on blue, with the words: A gift list shared with you." />\n    ${m}`,
            )
          : html,
    },
  }
}

// `base: './'` keeps every asset URL relative, so the same build works at
// https://user.github.io/hippo/, on a custom domain, or from any sub-path.
// The manifest's start_url, scope and share_target action are relative to
// the manifest, and the service worker is registered with scope './'.
export default defineConfig(({ mode }) => {
  // `vite build --mode native` (npm run android:web) builds the web assets that go inside the Android app.
  const native = mode === NATIVE_MODE
  const site = siteUrlFromEnv(process.env.HIPPO_SITE_URL)
  if (native && !site) {
    throw new Error(
      'The Android app build needs the public website address, because share links made in the app must point at it. Set HIPPO_SITE_URL, for example HIPPO_SITE_URL=https://owner.github.io/Hippo/',
    )
  }
  return {
    base: './',
    define: {
      // Compile-time constants (src/vite-env.d.ts). In the website build __HIPPO_NATIVE__ is false, so
      // every native-only branch and its dynamic import of plugin code is left out of the bundle.
      __HIPPO_NATIVE__: JSON.stringify(native),
      __HIPPO_SITE_URL__: JSON.stringify(site ?? ''),
    },
    ...(native ? { build: { outDir: NATIVE_OUT_DIR, emptyOutDir: true } } : {}),
    resolve: {
      // nostr-tools pins its own copies of the @noble libraries; use one copy of each.
      dedupe: ['@noble/curves', '@noble/hashes', '@noble/ciphers'],
    },
    plugins: [
      react(),
      VitePWA({
        // Inside the app the files come from the APK: no service worker, no manifest. The plugin
        // stays (disabled) so the website's update prompt module still resolves; the app never loads it.
        disable: native,
        registerType: 'prompt',
        injectRegister: false,
        // The glob below already picks up the icons; listing them again would precache them twice.
        includeManifestIcons: false,
        manifest: {
          id: './',
          name: 'Hippo',
          short_name: 'Hippo',
          description:
            'A private gift registry. Keep a wishlist, share lists by link, and let friends claim gifts without spoiling the surprise.',
          lang: 'en',
          start_url: './',
          scope: './',
          display: 'standalone',
          theme_color: THEME_COLOR,
          background_color: THEME_COLOR,
          categories: ['shopping', 'lifestyle'],
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: 'icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          share_target: {
            action: './',
            method: 'GET',
            enctype: 'application/x-www-form-urlencoded',
            params: { title: 'title', text: 'text', url: 'url' },
          },
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
          // Only the Latin subsets of Inter are precached. The others load
          // (and are cached) only when a page shows characters that need them.
          // The 512px icons are only for installing and the splash screen; the
          // browser fetches them itself, so they are not precached either.
          globIgnores: [
            '**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2',
            '**/icon-512.png',
            '**/icon-maskable-512.png',
            '**/og-image.png',
          ],
          runtimeCaching: [
            {
              urlPattern: /\/assets\/inter-[a-z-]+-wght-normal-[\w-]+\.woff2$/,
              handler: 'CacheFirst',
              options: { cacheName: 'hippo-fonts', expiration: { maxEntries: 16 } },
            },
          ],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
        },
      }),
      contentSecurityPolicy(native ? NATIVE_CSP : CSP),
      // Link preview tags are for the website only: nobody shares the app's local page.
      openGraphUrls(native ? undefined : site),
      ...(native && site ? [siteAddressFile(site)] : []),
    ],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }
})
