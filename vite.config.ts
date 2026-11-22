/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Hero-top blue from the design tokens (--blue-800); also the splash colour.
const THEME_COLOR = '#12297a'

/**
 * Strict Content-Security-Policy for the built app. Only what Hippo needs:
 * its own files, relays over wss: (ws: for the loopback test relay), item
 * pictures over https:, and data: for the inline SVG film grain in the CSS.
 * No inline scripts or inline <style>; React's `style` props go through the
 * CSSOM, which style-src does not restrict. Injected at build time only,
 * because Vite's dev server relies on inline scripts and styles.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https: data: blob:",
  "font-src 'self'",
  "connect-src 'self' wss: ws:",
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
      handler: (html) => html.replace(/<meta charset="UTF-8" \/>/i, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  }
}

// `base: './'` keeps every asset URL relative, so the same build works at
// https://user.github.io/hippo/, on a custom domain, or from any sub-path.
// The manifest's start_url, scope and share_target action are relative to
// the manifest, and the service worker is registered with scope './'.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'Hippo',
        short_name: 'Hippo',
        description: 'A private gift registry. Keep a wishlist, share lists by link, and let friends claim gifts without spoiling the surprise.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
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
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
    contentSecurityPolicy(),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
