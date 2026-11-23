import { describe, expect, it } from 'vitest'
import { installGuideFor, installHeading, installPlacement, installTaskName, moveWishesNote, ownStorageReason, whyInstall, type GuideText, type InstallEnv, type InstallKind } from './guide.ts'

// Real user-agent strings, as each browser sends them (iOS 26 Safari reports its OS as 18_6).
const UA = {
  iphoneSafari26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphoneSafari17: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadSafari: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/141.0.3537.86 Mobile/15E148 Safari/605.1.15',
  iphoneDuckDuckGo: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.27.79 (iPhone15,2; iOS 18_6; en_GB; en-GB; scale=3.00; 1179x2556; 734582132)',
  iphoneFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.40.108;FBBV/700000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3;FBCR/;FBID/phone;FBLC/en_GB;FBOP/80]',
  iphoneMessenger: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/490.0.0.31.110;FBBV/700000001;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6]',
  iphoneGoogleApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/385.0.776480912 Mobile/15E148 Safari/604.1',
  iphoneTikTok: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_41.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/GB',
  androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
  androidEdge: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 EdgA/141.0.0.0',
  androidOpera: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 OPR/92.0.0.0',
  androidFacebook:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.70 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/490.0.0.48.108;]',
  androidInstagram:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.70 Mobile Safari/537.36 Instagram 400.0.0.37.70 Android (34/14; 420dpi; 1080x2205; Google/google; Pixel 8; shiba; shiba; en_GB; 734582133)',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.70 Mobile Safari/537.36',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  windowsFirefoxOld: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0',
  macSafari26: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  macSafari16: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  linuxHeadless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
  linuxOpera: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/125.0.0.0',
  unknown: 'Mozilla/5.0 (linux) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.1.0',
} as const

const env = (userAgent: string, more: Partial<InstallEnv> = {}): InstallEnv => ({ userAgent, maxTouchPoints: 0, standalone: false, canPrompt: false, ...more })
const words = (t: GuideText): string => t.map((p) => (typeof p === 'string' ? p : p.term)).join('')
const stepsOf = (e: InstallEnv): string[] => installGuideFor(e).steps.map((s) => words(s.text))

describe('which instructions a browser gets', () => {
  const table: Array<[string, InstallEnv, InstallKind]> = [
    ['iPhone Safari (iOS 26)', env(UA.iphoneSafari26, { maxTouchPoints: 5 }), 'ios-safari'],
    ['iPhone Safari (iOS 17)', env(UA.iphoneSafari17, { maxTouchPoints: 5 }), 'ios-safari'],
    ['iPad Safari', env(UA.ipadSafari, { maxTouchPoints: 5 }), 'ios-safari'],
    ['iPad asking for desktop sites', env(UA.ipadDesktopMode, { maxTouchPoints: 5 }), 'ios-safari'],
    ['Chrome on iPhone', env(UA.iphoneChrome, { maxTouchPoints: 5 }), 'ios-chrome'],
    ['Firefox on iPhone', env(UA.iphoneFirefox, { maxTouchPoints: 5 }), 'ios-firefox'],
    ['Edge on iPhone', env(UA.iphoneEdge, { maxTouchPoints: 5 }), 'ios-edge'],
    ['DuckDuckGo on iPhone (not told apart: generic)', env(UA.iphoneDuckDuckGo, { maxTouchPoints: 5 }), 'ios-other'],
    ['Instagram on iPhone', env(UA.iphoneInstagram, { maxTouchPoints: 5 }), 'in-app'],
    ['Facebook on iPhone', env(UA.iphoneFacebook, { maxTouchPoints: 5 }), 'in-app'],
    ['Messenger on iPhone', env(UA.iphoneMessenger, { maxTouchPoints: 5 }), 'in-app'],
    ['the Google app on iPhone', env(UA.iphoneGoogleApp, { maxTouchPoints: 5 }), 'in-app'],
    ['TikTok on iPhone', env(UA.iphoneTikTok, { maxTouchPoints: 5 }), 'in-app'],
    ['Chrome on Android, no prompt yet', env(UA.androidChrome, { brands: ['Google Chrome', 'Chromium', 'Not?A_Brand'] }), 'android-chrome'],
    ['Chrome on Android with the prompt', env(UA.androidChrome, { canPrompt: true }), 'prompt'],
    ['Samsung Internet', env(UA.androidSamsung), 'android-samsung'],
    ['Firefox on Android', env(UA.androidFirefox), 'android-firefox'],
    ['Edge on Android (generic)', env(UA.androidEdge, { brands: ['Microsoft Edge', 'Chromium'] }), 'android-other'],
    ['Opera on Android (generic)', env(UA.androidOpera), 'android-other'],
    ['Facebook on Android', env(UA.androidFacebook), 'in-app'],
    ['Instagram on Android', env(UA.androidInstagram), 'in-app'],
    ['another app’s web view on Android', env(UA.androidWebView), 'in-app'],
    ['Chrome on Windows, no prompt', env(UA.windowsChrome, { brands: ['Google Chrome', 'Chromium'] }), 'desktop-chrome'],
    ['Chrome on Windows with the prompt', env(UA.windowsChrome, { canPrompt: true }), 'prompt'],
    ['Edge on Windows', env(UA.windowsEdge, { brands: ['Microsoft Edge', 'Chromium'] }), 'desktop-edge'],
    ['Firefox on Windows', env(UA.windowsFirefox), 'desktop-firefox'],
    ['Firefox on a Mac', env(UA.macFirefox), 'desktop-firefox'],
    ['Safari 26 on a Mac', env(UA.macSafari26), 'mac-safari'],
    ['Safari 16 on a Mac (no Add to Dock: generic)', env(UA.macSafari16), 'desktop-other'],
    ['Chrome on a Mac', env(UA.macChrome), 'desktop-chrome'],
    ['Brave (Chrome’s user agent, Brave’s brand)', env(UA.windowsChrome, { brands: ['Brave', 'Chromium'] }), 'desktop-other'],
    ['Opera on Linux', env(UA.linuxOpera), 'desktop-other'],
    ['an unknown browser', env(UA.unknown), 'desktop-other'],
    ['running installed on iPhone', env(UA.iphoneSafari26, { maxTouchPoints: 5, standalone: true }), 'installed'],
    ['running installed on Android, prompt or not', env(UA.androidChrome, { standalone: true, canPrompt: true }), 'installed'],
  ]
  it.each(table)('%s', (_name, e, kind) => {
    expect(installGuideFor(e).kind).toBe(kind)
  })
})

describe('the steps, in the words each device shows', () => {
  it('iPhone Safari 26: Share (perhaps under ⋯), Add to Home Screen, Open as Web App and Add', () => {
    expect(stepsOf(env(UA.iphoneSafari26, { maxTouchPoints: 5 }))).toEqual([
      'Tap Share. If it is not in the toolbar, tap ⋯ first.',
      'Scroll down and tap Add to Home Screen.',
      'Leave Open as Web App on and tap Add.',
    ])
  })
  it('older iPhone Safari: Share, Add to Home Screen, Add', () => {
    expect(stepsOf(env(UA.iphoneSafari17, { maxTouchPoints: 5 }))).toEqual(['Tap Share.', 'Scroll down and tap Add to Home Screen.', 'Tap Add.'])
  })
  it('Chrome and Firefox on iPhone: Share in the address bar', () => {
    for (const ua of [UA.iphoneChrome, UA.iphoneFirefox]) expect(stepsOf(env(ua, { maxTouchPoints: 5 }))[0]).toBe('Tap Share in the address bar.')
  })
  it('two or three steps everywhere, each with an icon', () => {
    for (const ua of Object.values(UA)) {
      const g = installGuideFor(env(ua, { maxTouchPoints: /iPhone|iPad/.test(ua) ? 5 : 0 }))
      expect(g.steps.length).toBeGreaterThanOrEqual(2)
      expect(g.steps.length).toBeLessThanOrEqual(3)
      for (const s of g.steps) expect(s.icon).toBeTruthy()
    }
  })
  it('the prompt and an installed app need no steps', () => {
    expect(installGuideFor(env(UA.androidChrome, { canPrompt: true })).steps).toEqual([])
    expect(installGuideFor(env(UA.androidChrome, { standalone: true })).steps).toEqual([])
  })
  it('Android: Chrome’s menu route, Samsung Internet’s and Firefox’s own', () => {
    expect(stepsOf(env(UA.androidChrome))).toEqual(['Tap ⋮ to open the menu.', 'Tap Add to home screen.', 'Tap Install.'])
    expect(stepsOf(env(UA.androidSamsung))).toEqual(['Tap the menu button, ≡.', 'Tap Add page to.', 'Tap Home screen.'])
    expect(stepsOf(env(UA.androidFirefox))[1]).toBe('Tap Install or Add to Home screen.')
    expect(stepsOf(env(UA.androidEdge))).toEqual(['Open your browser’s menu.', 'Tap Install app or Add to Home screen.'])
  })
  it('in-app browsers: copy the link and open it in Safari or Chrome', () => {
    const ios = installGuideFor(env(UA.iphoneInstagram, { maxTouchPoints: 5 }))
    expect(ios.realBrowser).toBe('Safari')
    expect(words(ios.steps[1]?.text ?? [])).toBe('Open Safari and paste the link into the address bar.')
    expect(installGuideFor(env(UA.androidFacebook)).realBrowser).toBe('Chrome')
  })
  it('computers: Chrome’s and Edge’s menus, File then Add to Dock in Safari, a bookmark in Firefox', () => {
    expect(stepsOf(env(UA.windowsChrome))[1]).toBe('Choose Cast, save, and share.')
    expect(stepsOf(env(UA.windowsEdge))[1]).toBe('Choose Apps.')
    expect(stepsOf(env(UA.macSafari26))).toEqual(['In the menu bar, choose File.', 'Choose Add to Dock.', 'Click Add.'])
    expect(stepsOf(env(UA.macFirefox))[0]).toBe('Press ⌘D.')
    expect(stepsOf(env(UA.windowsFirefox))[0]).toBe('Press Ctrl+D.')
  })
  it('Firefox on Windows 143 and later can pin to the taskbar; earlier and other systems cannot', () => {
    expect(words(installGuideFor(env(UA.windowsFirefox)).note ?? [])).toContain('Add tab to taskbar')
    expect(installGuideFor(env(UA.windowsFirefoxOld)).note).toBeUndefined()
    expect(installGuideFor(env(UA.macFirefox)).note).toBeUndefined()
  })
})

describe('where installing fits and what it is called', () => {
  it('comes first where the installed app keeps its own storage, late elsewhere, and not at all once installed', () => {
    expect(installPlacement(installGuideFor(env(UA.iphoneSafari26, { maxTouchPoints: 5 })))).toBe('first')
    expect(installPlacement(installGuideFor(env(UA.iphoneChrome, { maxTouchPoints: 5 })))).toBe('first')
    expect(installPlacement(installGuideFor(env(UA.ipadDesktopMode, { maxTouchPoints: 5 })))).toBe('first')
    expect(installPlacement(installGuideFor(env(UA.macSafari26)))).toBe('first')
    expect(installPlacement(installGuideFor(env(UA.androidInstagram)))).toBe('first')
    expect(installPlacement(installGuideFor(env(UA.androidChrome)))).toBe('late')
    expect(installPlacement(installGuideFor(env(UA.androidChrome, { canPrompt: true })))).toBe('late')
    expect(installPlacement(installGuideFor(env(UA.windowsChrome)))).toBe('late')
    expect(installPlacement(installGuideFor(env(UA.windowsFirefox)))).toBe('late')
    expect(installPlacement(installGuideFor(env(UA.iphoneSafari26, { maxTouchPoints: 5, standalone: true })))).toBe('none')
  })
  it('says why in one sentence, and the share sheet only where it is true', () => {
    expect(whyInstall(installGuideFor(env(UA.androidChrome)))).toContain('Share')
    expect(whyInstall(installGuideFor(env(UA.iphoneSafari26, { maxTouchPoints: 5 })))).not.toContain('Share')
    expect(whyInstall(installGuideFor(env(UA.windowsChrome)))).not.toContain('Share')
    expect(whyInstall(installGuideFor(env(UA.windowsFirefox)))).toContain('cannot install')
  })
  it('explains the separate copy on iPhone, iPad and the Mac, and how to move wishes later', () => {
    expect(ownStorageReason(installGuideFor(env(UA.iphoneSafari26, { maxTouchPoints: 5 })))).toBe(
      'On iPhone, the Home Screen app keeps its own copy of your wishes, so it is best to add it before you start.',
    )
    expect(ownStorageReason(installGuideFor(env(UA.ipadSafari, { maxTouchPoints: 5 })))).toMatch(/^On iPad,/)
    expect(ownStorageReason(installGuideFor(env(UA.macSafari26)))).toMatch(/^On a Mac, the Dock app/)
    expect(ownStorageReason(installGuideFor(env(UA.androidChrome)))).toBeUndefined()
    expect(moveWishesNote(installGuideFor(env(UA.iphoneSafari26, { maxTouchPoints: 5 })))).toMatch(/Export backup.*Import backup/)
    expect(moveWishesNote(installGuideFor(env(UA.iphoneSafari26, { maxTouchPoints: 5, standalone: true })))).toMatch(/Export backup.*Import backup here/)
    expect(moveWishesNote(installGuideFor(env(UA.androidChrome)))).toBeUndefined()
  })
  it('names the task in the device’s words', () => {
    expect(installTaskName(installGuideFor(env(UA.iphoneSafari26, { maxTouchPoints: 5 })))).toBe('Put Hippo on your Home Screen')
    expect(installTaskName(installGuideFor(env(UA.androidChrome)))).toBe('Put Hippo on your home screen')
    expect(installTaskName(installGuideFor(env(UA.macSafari26)))).toBe('Add Hippo to the Dock')
    expect(installTaskName(installGuideFor(env(UA.windowsChrome)))).toBe('Install Hippo')
    expect(installHeading(installGuideFor(env(UA.iphoneInstagram, { maxTouchPoints: 5 })))).toEqual({ muted: 'Open Hippo', bright: 'in Safari first' })
  })
  it('installing is possible everywhere but Firefox on a computer', () => {
    expect(installGuideFor(env(UA.windowsFirefox)).canInstall).toBe(false)
    expect(installGuideFor(env(UA.iphoneInstagram)).canInstall).toBe(true)
    expect(installGuideFor(env(UA.unknown)).canInstall).toBe(true)
  })
  it('never uses an em dash', () => {
    for (const ua of Object.values(UA)) {
      const g = installGuideFor(env(ua))
      const all = [...g.steps.map((s) => words(s.text)), words(g.note ?? []), whyInstall(g), ownStorageReason(g) ?? '', moveWishesNote(g) ?? '']
      for (const line of all) expect(line).not.toContain('—')
    }
  })
})
