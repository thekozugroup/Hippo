// How to install Hippo on this device: a pure mapping from a described
// environment (user agent, client hint brands, touch points, whether Hippo
// runs installed, whether the browser offered its install prompt) to one set
// of instructions. Setup, the Home checklist and Settings all show the result
// through `InstallGuide`. When the browser cannot be told apart reliably the
// mapping falls back to generic wording rather than guessing.
//
// Wording follows what each browser shows, as checked in November 2026:
// - Safari on iPhone and iPad (Apple's iPhone User Guide): Share (inside the
//   page menu, "⋯", in the default iOS 26 layout), Add to Home Screen, Open as
//   Web App, Add. Before Safari 26 there is no page menu and no switch.
// - Chrome and Firefox on iOS 16.4 and later: Share in the address bar, then
//   Add to Home Screen, then Add (Mozilla's help page; Chrome by report).
// - Chrome on Android: ⋮, Add to home screen, Install. Samsung Internet: the
//   menu, Add page to, Home screen. Firefox on Android: ⋮, then Install (sites
//   with a manifest) or Add to Home screen.
// - Chrome on a computer: ⋮, Cast, save, and share, Install page as app (or
//   "Install Hippo" for an installable site). Edge: Settings and more (⋯), Apps.
// - Safari on a Mac (17 and later): File, Add to Dock. Its Dock app, like a
//   Home Screen app on iOS, keeps its own website data (only cookies are copied).
// - Firefox on a computer has no install; on Windows, Firefox 143 and later can
//   pin a page with "Add tab to taskbar" in the address bar.

export interface InstallEnv {
  userAgent: string
  /** `navigator.userAgentData.brands`, when the browser has them. */
  brands?: readonly string[]
  maxTouchPoints: number
  /** Hippo is running as an installed app (display-mode standalone, or iOS `navigator.standalone`). */
  standalone: boolean
  /** The browser has offered its install prompt (`beforeinstallprompt`). */
  canPrompt: boolean
}

export type InstallKind =
  | 'installed'
  | 'prompt'
  | 'ios-safari'
  | 'ios-chrome'
  | 'ios-firefox'
  | 'ios-edge'
  | 'ios-other'
  | 'in-app'
  | 'android-chrome'
  | 'android-samsung'
  | 'android-firefox'
  | 'android-other'
  | 'mac-safari'
  | 'desktop-chrome'
  | 'desktop-edge'
  | 'desktop-firefox'
  | 'desktop-other'

export type Platform = 'iphone' | 'ipad' | 'android' | 'mac' | 'windows' | 'computer'

/** Plain icons that resemble what the browser shows; never logos. */
export type GuideIcon = 'share' | 'add-square' | 'more-vertical' | 'more' | 'menu' | 'install' | 'dock' | 'bookmark' | 'keyboard' | 'copy' | 'open' | 'check' | 'apps'

/** Text with the words the device shows marked as terms (shown in bold). */
export type GuideText = ReadonlyArray<string | { term: string }>

export interface GuideStep {
  icon: GuideIcon
  text: GuideText
}

export interface InstallGuide {
  kind: InstallKind
  platform: Platform
  /** Two or three numbered actions; empty for `prompt` (one button) and `installed`. */
  steps: readonly GuideStep[]
  /** One extra line under the steps, when needed. */
  note?: GuideText
  /** Installing as an app is possible on this device (possibly after opening a real browser). */
  canInstall: boolean
  /** The installed app keeps its own storage, separate from this browser's, so wishes added here do not appear there. */
  ownStorage: boolean
  /** Once installed, Hippo is offered in the system share sheet. */
  shareSheet: boolean
  /** What the device calls the place the icon goes. */
  place: 'Home Screen' | 'home screen' | 'Dock' | 'apps'
  /** The browser to name when this one cannot install: "Safari", "Chrome" or "your browser". */
  realBrowser: string
}

/** Where the install step sits in setup. */
export type InstallPlacement = 'first' | 'late' | 'none'

const t = (term: string) => ({ term })

function hasBrand(env: InstallEnv, name: string): boolean {
  return (env.brands ?? []).some((b) => b === name)
}

/** Links opened inside these apps load in their own web view, where installing is not possible. Conservative: known markers only. */
const IN_APP = /\b(FBAN|FBAV|FB_IAB|FBIOS|FB4A|Instagram|Messenger(?:ForiOS|LiteForiOS)?|WhatsApp|Snapchat|LinkedInApp|Pinterest|musical_ly|BytedanceWebview|TikTok|Line)\/|\bGSA\/|\[(?:FBAN|FB_IAB)/

function versionOf(ua: string, re: RegExp): number {
  const m = re.exec(ua)
  return m?.[1] ? Number.parseInt(m[1], 10) : 0
}

function iosPlatform(env: InstallEnv): 'iphone' | 'ipad' | null {
  const ua = env.userAgent
  if (/iPad/.test(ua)) return 'ipad'
  if (/iPhone|iPod/.test(ua)) return 'iphone'
  // iPadOS asks for desktop sites by default and then reads as a Mac with a touch screen.
  if (/Macintosh/.test(ua) && env.maxTouchPoints > 1) return 'ipad'
  return null
}

function base(kind: InstallKind, platform: Platform, steps: readonly GuideStep[], extra: Partial<InstallGuide> = {}): InstallGuide {
  const ios = platform === 'iphone' || platform === 'ipad'
  return {
    kind,
    platform,
    steps,
    canInstall: true,
    ownStorage: false,
    shareSheet: false,
    place: ios ? 'Home Screen' : platform === 'android' ? 'home screen' : platform === 'mac' && kind === 'mac-safari' ? 'Dock' : 'apps',
    realBrowser: ios || platform === 'mac' ? 'Safari' : platform === 'android' ? 'Chrome' : 'your browser',
    ...extra,
  }
}

function iosGuide(env: InstallEnv, platform: 'iphone' | 'ipad'): InstallGuide {
  const ua = env.userAgent
  const own = { ownStorage: true }
  const addToHome: GuideStep = { icon: 'add-square', text: ['Scroll down and tap ', t('Add to Home Screen'), '.'] }
  const add: GuideStep = { icon: 'check', text: ['Tap ', t('Add'), '.'] }
  const shareInBar: GuideStep = { icon: 'share', text: ['Tap ', t('Share'), ' in the address bar.'] }
  if (/CriOS\//.test(ua)) return base('ios-chrome', platform, [shareInBar, addToHome, add], own)
  if (/FxiOS\//.test(ua)) return base('ios-firefox', platform, [shareInBar, addToHome, add], own)
  if (/EdgiOS\//.test(ua)) return base('ios-edge', platform, [{ icon: 'menu', text: ['Open the menu and tap ', t('Share'), '.'] }, addToHome, add], own)
  // Safari: "Version/x ... Safari/", with no other browser's token. Anything else gets generic wording.
  const safari = /Version\/\d+.*Safari\//.test(ua) && !/(OPiOS|OPT|DuckDuckGo|Brave|YaBrowser|Focus|Ddg|GSA)\//.test(ua)
  if (safari) {
    const v = versionOf(ua, /Version\/(\d+)/)
    if (v >= 26) {
      return base(
        'ios-safari',
        platform,
        [
          { icon: 'share', text: ['Tap ', t('Share'), '. If it is not in the toolbar, tap ', t('⋯'), ' first.'] },
          addToHome,
          { icon: 'check', text: ['Leave ', t('Open as Web App'), ' on and tap ', t('Add'), '.'] },
        ],
        own,
      )
    }
    return base('ios-safari', platform, [{ icon: 'share', text: ['Tap ', t('Share'), '.'] }, addToHome, add], own)
  }
  return base('ios-other', platform, [{ icon: 'share', text: ['Find ', t('Share'), ' in your browser and tap it.'] }, { icon: 'add-square', text: ['Tap ', t('Add to Home Screen'), '.'] }], {
    ...own,
    note: ['If you cannot find it, open this page in ', t('Safari'), '.'],
  })
}

function androidGuide(env: InstallEnv): InstallGuide {
  const ua = env.userAgent
  const extra = { shareSheet: true }
  if (/SamsungBrowser\//.test(ua) || hasBrand(env, 'Samsung Internet')) {
    return base(
      'android-samsung',
      'android',
      [
        { icon: 'menu', text: ['Tap the menu button, ', t('≡'), '.'] },
        { icon: 'add-square', text: ['Tap ', t('Add page to'), '.'] },
        { icon: 'check', text: ['Tap ', t('Home screen'), '.'] },
      ],
      extra,
    )
  }
  if (/Firefox\//.test(ua) && /Mobile|Tablet/.test(ua)) {
    return base(
      'android-firefox',
      'android',
      [
        { icon: 'more-vertical', text: ['Tap ', t('⋮'), '.'] },
        { icon: 'add-square', text: ['Tap ', t('Install'), ' or ', t('Add to Home screen'), '.'] },
        { icon: 'check', text: ['Tap ', t('Add'), '.'] },
      ],
      extra,
    )
  }
  // Chrome itself: Chromium-based browsers that add their own token are not Chrome.
  const otherChromium = /(EdgA|OPR|OPX|YaBrowser|Brave|Vivaldi|UCBrowser|MiuiBrowser|HuaweiBrowser|HeyTapBrowser|DuckDuckGo)\//.test(ua)
  const brandsSayChrome = env.brands === undefined || env.brands.length === 0 || hasBrand(env, 'Google Chrome')
  if (/Chrome\/\d+/.test(ua) && !otherChromium && brandsSayChrome) {
    return base(
      'android-chrome',
      'android',
      [
        { icon: 'more-vertical', text: ['Tap ', t('⋮'), '.'] },
        { icon: 'add-square', text: ['Tap ', t('Add to home screen'), '.'] },
        { icon: 'check', text: ['Tap ', t('Install'), '.'] },
      ],
      extra,
    )
  }
  return base(
    'android-other',
    'android',
    [
      { icon: 'more-vertical', text: ['Open your browser’s menu.'] },
      { icon: 'add-square', text: ['Tap ', t('Install app'), ' or ', t('Add to Home screen'), '.'] },
    ],
    extra,
  )
}

function desktopPlatform(ua: string): Platform {
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac'
  if (/Windows/.test(ua)) return 'windows'
  return 'computer'
}

function desktopGuide(env: InstallEnv): InstallGuide {
  const ua = env.userAgent
  const platform = desktopPlatform(ua)
  if (/Firefox\//.test(ua) && !/Seamonkey\//.test(ua)) {
    const pinnable = platform === 'windows' && versionOf(ua, /Firefox\/(\d+)/) >= 143
    return base(
      'desktop-firefox',
      platform,
      [
        { icon: 'keyboard', text: ['Press ', t(platform === 'mac' ? '⌘D' : 'Ctrl+D'), '.'] },
        { icon: 'check', text: ['Click ', t('Save'), '.'] },
      ],
      {
        canInstall: false,
        ...(pinnable ? { note: ['On Windows you can also pin Hippo with ', t('Add tab to taskbar'), ' in the address bar.'] } : {}),
      },
    )
  }
  if (/Edg\//.test(ua) || hasBrand(env, 'Microsoft Edge')) {
    return base('desktop-edge', platform, [
      { icon: 'more', text: ['Open ', t('Settings and more'), ', the ', t('⋯'), ' button.'] },
      { icon: 'apps', text: ['Choose ', t('Apps'), '.'] },
      { icon: 'install', text: ['Choose ', t('Install Hippo'), ' or ', t('Install this site as an app'), '.'] },
    ])
  }
  const otherChromium = /(OPR|YaBrowser|Vivaldi|Brave|Whale)\//.test(ua) || hasBrand(env, 'Opera') || hasBrand(env, 'Brave')
  const chromeBrand = env.brands === undefined || env.brands.length === 0 || hasBrand(env, 'Google Chrome') || hasBrand(env, 'HeadlessChrome') || hasBrand(env, 'Chromium')
  if (/Chrome\/\d+/.test(ua) && !otherChromium && chromeBrand) {
    return base('desktop-chrome', platform, [
      { icon: 'more-vertical', text: ['Open the Chrome menu, ', t('⋮'), '.'] },
      { icon: 'menu', text: ['Choose ', t('Cast, save, and share'), '.'] },
      { icon: 'install', text: ['Choose ', t('Install Hippo'), ' or ', t('Install page as app'), '.'] },
    ])
  }
  if (platform === 'mac' && /Version\/\d+.*Safari\//.test(ua) && !/Chrome|Chromium|OPR|Edg/.test(ua)) {
    if (versionOf(ua, /Version\/(\d+)/) >= 17) {
      return base(
        'mac-safari',
        'mac',
        [
          { icon: 'menu', text: ['In the menu bar, choose ', t('File'), '.'] },
          { icon: 'dock', text: ['Choose ', t('Add to Dock'), '.'] },
          { icon: 'check', text: ['Click ', t('Add'), '.'] },
        ],
        { ownStorage: true, place: 'Dock' },
      )
    }
  }
  return base('desktop-other', platform, [
    { icon: 'install', text: ['Look for an install button in the address bar.'] },
    { icon: 'more', text: ['Or open the browser menu and choose ', t('Install'), ' if it is there.'] },
  ])
}

/** The instructions for this environment. */
export function installGuideFor(env: InstallEnv): InstallGuide {
  const ua = env.userAgent
  const ios = iosPlatform(env)
  const android = /Android/.test(ua)
  const platform: Platform = ios ?? (android ? 'android' : desktopPlatform(ua))
  if (env.standalone) return base('installed', platform, [], { shareSheet: android })
  // A web view inside another app cannot install, and keeps its own storage.
  if (IN_APP.test(ua) || (android && /; wv\)/.test(ua))) {
    const browser = ios ? 'Safari' : android ? 'Chrome' : 'your browser'
    return base(
      'in-app',
      platform,
      [
        { icon: 'copy', text: ['Tap ', t('Copy link'), ' below.'] },
        { icon: 'open', text: ['Open ', browser === 'your browser' ? 'your browser' : t(browser), ' and paste the link into the address bar.'] },
        { icon: 'check', text: ['Follow the steps Hippo shows there.'] },
      ],
      { ownStorage: true, realBrowser: browser },
    )
  }
  if (env.canPrompt) return base('prompt', platform, [], { shareSheet: android })
  if (ios) return iosGuide(env, ios)
  if (android) return androidGuide(env)
  return desktopGuide(env)
}

/**
 * Where setup puts the install step: first where the installed app keeps its own storage (so
 * nothing answered in the browser is left behind), near the end where it shares the browser's
 * storage, and nowhere once Hippo runs installed.
 */
export function installPlacement(g: Pick<InstallGuide, 'kind' | 'ownStorage'>): InstallPlacement {
  if (g.kind === 'installed') return 'none'
  return g.ownStorage ? 'first' : 'late'
}

/** One honest sentence on why installing is worth it. */
export function whyInstall(g: InstallGuide): string {
  if (g.kind === 'desktop-firefox') return 'A bookmark gets you back to Hippo in one click.'
  if (g.place === 'Home Screen') return 'Added to your Home Screen, Hippo opens full screen like an app.'
  if (g.place === 'Dock') return 'Added to the Dock, Hippo opens in its own window like an app.'
  if (g.platform === 'android') return 'Installed, Hippo opens from your home screen like an app and shows up when you tap Share in other apps.'
  if (g.kind === 'in-app') return 'Opened in your browser, Hippo can be installed and opens like an app.'
  return 'Installed, Hippo opens in its own window like an app.'
}

/** The device's name for the reader: "iPhone", "iPad", "Mac" or "phone". */
function deviceName(p: Platform): string {
  return p === 'iphone' ? 'iPhone' : p === 'ipad' ? 'iPad' : p === 'mac' ? 'Mac' : p === 'android' ? 'phone' : 'computer'
}

/** Why the step comes first, where the installed app keeps its own copy. Undefined elsewhere. */
export function ownStorageReason(g: InstallGuide): string | undefined {
  if (!g.ownStorage) return undefined
  if (g.kind === 'in-app') return `Wishes added inside this app stay here, so open Hippo in ${g.realBrowser} before you start.`
  const where = g.place === 'Dock' ? 'the Dock app' : 'the Home Screen app'
  return `On ${g.platform === 'mac' ? 'a Mac' : deviceName(g.platform)}, ${where} keeps its own copy of your wishes, so it is best to add it before you start.`
}

/** For later (Settings, the checklist): how to bring wishes from this browser into the installed app. */
export function moveWishesNote(g: InstallGuide): string | undefined {
  if (!g.ownStorage || g.kind === 'in-app') return undefined
  const app = g.place === 'Dock' ? 'the Dock app' : 'the Home Screen app'
  return `${app === 'the Dock app' ? 'The Dock app' : 'The Home Screen app'} keeps its own copy of your wishes. To move wishes you added in this browser, use Export backup in Settings here, then open ${app} and use Import backup in its Settings.`
}

/** Reads the environment from the browser. Kept apart so everything above stays testable. */
export function readInstallEnv(canPrompt: boolean): InstallEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const data = nav && 'userAgentData' in nav ? (nav as { userAgentData?: { brands?: ReadonlyArray<{ brand?: unknown }> } }).userAgentData : undefined
  const brands = data?.brands?.map((b) => (typeof b.brand === 'string' ? b.brand : '')).filter(Boolean)
  const iosStandalone = nav !== undefined && (nav as { standalone?: unknown }).standalone === true
  const standalone =
    iosStandalone ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: window-controls-overlay)').matches))
  return {
    userAgent: nav?.userAgent ?? '',
    ...(brands && brands.length > 0 ? { brands } : {}),
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    standalone,
    canPrompt,
  }
}
