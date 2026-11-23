// Capacitor configuration for the Android app (README, "Android app").
// The web assets are built with `npm run android:web` (vite --mode native)
// into dist-native/ and copied into the APK by `cap sync`.
//
// Capacitor reads this file with Node's own TypeScript support (TypeScript 7
// has no transpile API), so it may only use syntax that can be erased.

import type { CapacitorConfig } from '@capacitor/cli'

// Hero-top blue (--blue-900), as in vite.config.ts THEME_COLOR.
const HERO_BLUE = '#1e3a8a'

const config: CapacitorConfig = {
  // Decided before the first release, and never changed after it: Android treats an app with
  // another id as a different app, so installed copies could not update in place.
  appId: 'io.github.thekozugroup.hippo',
  appName: 'Hippo',
  webDir: 'dist-native',
  // No Capacitor logging, in debug builds too: plugin calls can carry share links (with their
  // secret) and shared text, and none of that belongs in the device log.
  loggingBehavior: 'none',
  android: {
    // WebView debugging follows the build: on in debug builds, off in release builds (Capacitor's
    // default, left unset on purpose).
    backgroundColor: HERO_BLUE,
    allowMixedContent: false,
  },
  plugins: {
    // Built-in plugin: edge to edge, with the insets handed to CSS as --safe-area-inset-*.
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
      initialViewportFitValueHint: 'cover',
    },
    SplashScreen: {
      // The app hides the splash once the first screen has painted; this is only the fallback.
      launchAutoHide: true,
      launchShowDuration: 3000,
      launchFadeOutDuration: 150,
      backgroundColor: HERO_BLUE,
      showSpinner: false,
    },
    // Both stay off: the app's own fetch and cookies are not routed through native code.
    CapacitorHttp: { enabled: false },
    CapacitorCookies: { enabled: false },
  },
}

export default config
