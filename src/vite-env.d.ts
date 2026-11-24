/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/** True only in the Android app's web build (`vite build --mode native`); set by `define` in vite.config.ts. */
declare const __HIPPO_NATIVE__: boolean
/** The public website's address from HIPPO_SITE_URL at build time (ends in `/`), or '' when the build had none. */
declare const __HIPPO_SITE_URL__: string
/** This build's version, from package.json (Settings, Deployment checks). */
declare const __HIPPO_VERSION__: string
