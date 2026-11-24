// What the website build says about Hippo's installed forms, so a page can find out whether Hippo
// is already installed on this device (navigator.getInstalledRelatedApps, Chrome on Android) and
// offer "Open in the app" instead of asking to install again. Used by vite.config.ts at build time;
// pure, so it is unit tested.
//
// - The installed web app: the manifest lists itself (`platform: "webapp"`, the manifest's own URL,
//   relative, and its id). Chrome then reports it to pages within its scope. Always present.
// - The Android app: only when the build is given the app's package and the SHA-256 fingerprint of
//   the certificate it is signed with (HIPPO_ANDROID_PACKAGE, HIPPO_ANDROID_CERT_SHA256). Then the
//   manifest lists it (`platform: "play"`) and the site serves /.well-known/assetlinks.json, the
//   Digital Asset Links statement Android and Chrome check. Statements are read at the domain's
//   root, so this works only where the site is served at its own domain (a custom domain, Vercel),
//   not at a GitHub Pages project path. Without both values nothing about the app is emitted.

export interface AndroidApp {
  /** The Android application id, e.g. io.github.thekozugroup.hippo. */
  packageName: string
  /** The signing certificate's SHA-256 fingerprint as 32 colon-separated upper-case hex pairs. */
  sha256: string
}

export interface RelatedApplication {
  platform: string
  url: string
  id?: string
}

/** The manifest file vite-plugin-pwa writes next to index.html. */
export const MANIFEST_FILE = 'manifest.webmanifest'

const PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/

/** A fingerprint in any common spelling (colons or not, any case) as AA:BB:..., or undefined when it is not 32 bytes of hex. */
export function normalizeFingerprint(value: string): string | undefined {
  const hex = value.trim().replace(/:/g, '').toUpperCase()
  if (!/^[0-9A-F]{64}$/.test(hex)) return undefined
  return hex.match(/../g)?.join(':')
}

/**
 * The Android app from the build's environment, or undefined when neither value is set. One without
 * the other, or a malformed value, stops the build: a half-configured association would quietly
 * fail on people's phones.
 */
export function androidAppFromEnv(env: Record<string, string | undefined>): AndroidApp | undefined {
  const pkg = env.HIPPO_ANDROID_PACKAGE?.trim() ?? ''
  const cert = env.HIPPO_ANDROID_CERT_SHA256?.trim() ?? ''
  if (!pkg && !cert) return undefined
  if (!pkg || !cert) throw new Error('Set both HIPPO_ANDROID_PACKAGE and HIPPO_ANDROID_CERT_SHA256 to link the website with the Android app, or neither.')
  if (!PACKAGE.test(pkg)) throw new Error(`HIPPO_ANDROID_PACKAGE is not an Android package name: ${pkg}`)
  const sha256 = normalizeFingerprint(cert)
  if (!sha256) throw new Error('HIPPO_ANDROID_CERT_SHA256 must be the SHA-256 fingerprint of the signing certificate (32 bytes in hex).')
  return { packageName: pkg, sha256 }
}

/** The manifest's `related_applications`. */
export function relatedApplications(app: AndroidApp | undefined): RelatedApplication[] {
  return [
    { platform: 'webapp', url: `./${MANIFEST_FILE}`, id: './' },
    ...(app ? [{ platform: 'play', url: `https://play.google.com/store/apps/details?id=${app.packageName}`, id: app.packageName }] : []),
  ]
}

/** /.well-known/assetlinks.json for the Android app: it may handle the site's links, and Chrome may tell the site it is installed. */
export function assetLinksJson(app: AndroidApp): string {
  const statement = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: app.packageName, sha256_cert_fingerprints: [app.sha256] },
    },
  ]
  return `${JSON.stringify(statement, null, 2)}\n`
}
