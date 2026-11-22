/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https: data:",
  "font-src 'self'",
  `connect-src 'self' wss: ${LINK_PREVIEW_ORIGIN} ws://127.0.0.1:* ws://localhost:*`,
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'hippo-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html
          .replace(/<meta charset="UTF-8" \/>/i, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
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

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function openGraphUrls(): Plugin {
  const site = siteUrlFromEnv(process.env.HIPPO_SITE_URL)
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
export default defineConfig({
  base: './',
  resolve: {
    // nostr-tools pins its own copies of the @noble libraries; use one copy of each.
    dedupe: ['@noble/curves', '@noble/hashes', '@noble/ciphers'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // The glob below already picks up the icons; listing them again would precache them twice.
      includeManifestIcons: false,
      manifest: {
        id: './',
        name: 'Hippo',
        short_name: 'Hippo',
        description: 'A private gift registry. Keep a wishlist, share lists by link, and let friends claim gifts without spoiling the surprise.',
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
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
        globIgnores: ['**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2', '**/icon-512.png', '**/icon-maskable-512.png', '**/og-image.png'],
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
    contentSecurityPolicy(),
    openGraphUrls(),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
