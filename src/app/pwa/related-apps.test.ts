import { describe, expect, it } from 'vitest'
import { offersOpenInApp, readRelatedApps } from './open-in-app.ts'
import { androidAppFromEnv, assetLinksJson, normalizeFingerprint, relatedApplications } from './related-apps.ts'

const FP = '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5'

describe('the website names Hippo’s installed forms', () => {
  it('always lists its own web app, relative to the manifest', () => {
    expect(relatedApplications(undefined)).toEqual([{ platform: 'webapp', url: './manifest.webmanifest', id: './' }])
  })

  it('names the Android app only when both build settings are given', () => {
    expect(androidAppFromEnv({})).toBeUndefined()
    const app = androidAppFromEnv({ HIPPO_ANDROID_PACKAGE: 'io.github.thekozugroup.hippo', HIPPO_ANDROID_CERT_SHA256: FP.toLowerCase().replace(/:/g, '') })
    expect(app).toEqual({ packageName: 'io.github.thekozugroup.hippo', sha256: FP })
    expect(relatedApplications(app)[1]).toEqual({ platform: 'play', url: 'https://play.google.com/store/apps/details?id=io.github.thekozugroup.hippo', id: 'io.github.thekozugroup.hippo' })
    const links = JSON.parse(assetLinksJson(app!)) as unknown
    expect(links).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'io.github.thekozugroup.hippo', sha256_cert_fingerprints: [FP] },
      },
    ])
  })

  it('stops the build on a half or malformed setting', () => {
    expect(() => androidAppFromEnv({ HIPPO_ANDROID_PACKAGE: 'io.github.thekozugroup.hippo' })).toThrow(/both/)
    expect(() => androidAppFromEnv({ HIPPO_ANDROID_CERT_SHA256: FP })).toThrow(/both/)
    expect(() => androidAppFromEnv({ HIPPO_ANDROID_PACKAGE: 'hippo', HIPPO_ANDROID_CERT_SHA256: FP })).toThrow(/package/)
    expect(() => androidAppFromEnv({ HIPPO_ANDROID_PACKAGE: 'a.b', HIPPO_ANDROID_CERT_SHA256: 'AB:CD' })).toThrow(/SHA-256/)
    expect(normalizeFingerprint('zz')).toBeUndefined()
  })
})

describe('reading what the browser reports', () => {
  it('tells the web app and the Android app apart', () => {
    expect(readRelatedApps([{ platform: 'webapp', url: 'https://x/manifest.webmanifest' }])).toEqual({ webApp: true, androidApp: false })
    expect(readRelatedApps([{ platform: 'play', id: 'io.github.thekozugroup.hippo' }])).toEqual({ webApp: false, androidApp: true })
    expect(readRelatedApps([{ platform: 'play', id: 'com.other.app' }])).toEqual({ webApp: false, androidApp: false })
    expect(readRelatedApps('nonsense')).toEqual({ webApp: false, androidApp: false })
  })

  it('offers the Android link in Android browsers only: not installed, not in another app, not in the app', () => {
    expect(offersOpenInApp({ platform: 'android', kind: 'android-chrome' }, false)).toBe(true)
    expect(offersOpenInApp({ platform: 'android', kind: 'prompt' }, false)).toBe(true)
    expect(offersOpenInApp({ platform: 'android', kind: 'in-app' }, false)).toBe(false)
    expect(offersOpenInApp({ platform: 'android', kind: 'installed' }, false)).toBe(false)
    expect(offersOpenInApp({ platform: 'android', kind: 'android-chrome' }, true)).toBe(false)
    expect(offersOpenInApp({ platform: 'iphone', kind: 'ios-safari' }, false)).toBe(false)
    expect(offersOpenInApp({ platform: 'windows', kind: 'desktop-chrome' }, false)).toBe(false)
  })
})
