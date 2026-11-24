import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Route, Router, Switch, useLocation } from 'wouter'
import type { Core } from '../core/index.ts'
import { Skeleton } from '../ui/index.ts'
import { useCore } from './core/context.ts'
import { endBoot, isSetupBoot } from './core/boot.ts'
import { homeRedirect, peekCaptureDraft } from './core/capture.ts'
import { ClockNotice } from './core/ClockNotice.tsx'
import { CoreProvider } from './core/CoreProvider.tsx'
import { useGuestLists, useItems, useSettings, useSharedLists } from './core/data.ts'
import { NotifyProvider } from './core/NotifyProvider.tsx'
import { onboardingStepFor } from './core/onboarding.ts'
import { readSetupHint, writeSetupHint } from './core/setupHint.ts'
import { checkStorage } from './core/storage.ts'
import { applyTheme } from './core/theme.ts'
import { ErrorBoundary } from './layout/ErrorBoundary.tsx'
import { lazyScreen } from './layout/lazyScreen.tsx'
import { setRoutePreloader, useMotionLocation, useRouteEpoch } from './layout/motionLocation.ts'
import { titleFor } from './layout/titles.ts'
import { HomeScreen } from './screens/HomeScreen.tsx'
import { ListsScreen } from './screens/lists/ListsScreen.tsx'
import { NotFoundScreen } from './screens/NotFoundScreen.tsx'
import { StorageUnavailableScreen } from './screens/StorageUnavailableScreen.tsx'
import { WishlistScreen } from './screens/WishlistScreen.tsx'
import { markSeen } from '../core/index.ts'
import { welcomeStepsFor } from './core/onboarding.ts'
import { setWelcomeOrder } from './layout/routeMotion.ts'
import { installGuideFor, installPlacement, readInstallEnv } from './pwa/guide.ts'
import { isStandalone, onInstallChange, wasInstalledHere } from './pwa/install.ts'
import { isNativeApp } from './native/platform.ts'
import { takeTransferFromLocation } from './lib/transfer-inbox.ts'

// Setup's step order depends on where installing fits on this device; it is fixed for the page's life.
// Inside the Android app Hippo is already an app: there is no install step.
setWelcomeOrder(welcomeStepsFor(isNativeApp() ? 'none' : installPlacement(installGuideFor(readInstallEnv(false)))))

// Home, wishlist and lists load with the app; editors, the giver view,
// settings and first-run setup load on first use (and are precached for
// offline use). Each can be loaded ahead so a route transition lands on the
// real screen.
const ItemEditorScreen = lazyScreen(() => import('./screens/ItemEditorScreen.tsx').then((m) => m.default))
const ListEditorScreen = lazyScreen(() => import('./screens/lists/ListEditorScreen.tsx').then((m) => m.default))
const GiverScreen = lazyScreen(() => import('./screens/giver/GiverScreen.tsx').then((m) => m.GiverScreen))
const GiverLinkScreen = lazyScreen(() => import('./screens/giver/GiverScreen.tsx').then((m) => m.GiverLinkScreen))
const SettingsScreen = lazyScreen(() => import('./screens/settings/SettingsScreen.tsx').then((m) => m.default))
const OnboardingScreen = lazyScreen(() => import('./screens/onboarding/OnboardingScreen.tsx').then((m) => m.default))
const MoveScreen = lazyScreen(() => import('./screens/move/MoveScreen.tsx').then((m) => m.default))
const ReceiveScreen = lazyScreen(() => import('./screens/move/ReceiveScreen.tsx').then((m) => m.default))
const ExistingScreen = lazyScreen(() => import('./screens/move/ExistingScreen.tsx').then((m) => m.default))
const SiteScreen = lazyScreen(() => import('./screens/move/SiteScreen.tsx').then((m) => m.default))
const GalleryScreen = lazy(() => import('./screens/GalleryScreen.tsx'))
const UpdatePrompt = lazy(() => import('./pwa/UpdatePrompt.tsx'))

function preloadFor(path: string): Promise<unknown> | undefined {
  if (path.startsWith('/item/')) return ItemEditorScreen.preload()
  if (path.startsWith('/list/')) return ListEditorScreen.preload()
  if (path.startsWith('/g/') || path.startsWith('/l/')) return GiverScreen.preload()
  if (path === '/settings') return SettingsScreen.preload()
  if (path.startsWith('/welcome/')) return OnboardingScreen.preload()
  if (path === '/move') return MoveScreen.preload()
  if (path === '/move/receive') return ReceiveScreen.preload()
  if (path === '/existing') return ExistingScreen.preload()
  if (path === '/site') return SiteScreen.preload()
  return undefined
}
setRoutePreloader(preloadFor)

/** True when focus is now on something other than the page and other than `before`. */
function movedOn(before: Element | null): boolean {
  const now = document.activeElement
  return now !== null && now !== document.body && now !== document.documentElement && now !== before && now.isConnected
}

/** Moves focus to the new screen's heading and scrolls to the top after navigation. */
function RouteFocus() {
  const [location] = useLocation()
  const first = useRef(true)
  // Scroll before paint (inside a route transition's update), focus after it.
  useLayoutEffect(() => {
    if (first.current) return
    window.scrollTo(0, 0)
    // Leaving Home or setup: whatever shows now has its own background.
    if (!location.startsWith('/welcome/') && location !== '/') endBoot()
  }, [location])
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    // What has focus once the new screen is in place: the page itself (the control that was pressed
    // went with the old screen), or a control that stays, such as the navigation.
    const before = document.activeElement
    const id = window.requestAnimationFrame(() => {
      // Someone who already moved on to a control on the new screen (Tab, or a quick press) keeps it.
      if (movedOn(before)) return
      document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(id)
  }, [location])
  return null
}

/** Marks the app as booted shortly after the first screen, so small enter effects never delay first paint. */
function BootFlag() {
  useEffect(() => {
    const id = window.setTimeout(() => {
      document.documentElement.dataset.booted = ''
    }, 800)
    return () => window.clearTimeout(id)
  }, [])
  return null
}

/** One title per route (WCAG 2.4.2), never including list names or link data. */
function DocumentTitle() {
  const [location] = useLocation()
  useEffect(() => {
    document.title = titleFor(location)
  }, [location])
  return null
}

/** Remembers that Hippo was installed (running installed, or the browser said so), so the checklist can tick it later in the browser too. */
function InstallRecorder() {
  const core = useCore()
  const settings = useSettings()
  // The Android app is not the installed website, so it records nothing here.
  const known = settings === undefined || settings.seen.appInstalled !== undefined || isNativeApp()
  useEffect(() => {
    if (known) return
    const record = () => {
      if (isStandalone() || wasInstalledHere()) void markSeen(core.db, 'appInstalled', core.now()).catch(() => undefined)
    }
    record()
    return onInstallChange(record)
  }, [known, core])
  return null
}

function ThemeSync() {
  const settings = useSettings()
  const theme = settings?.theme
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])
  return null
}

function Loading() {
  // Likely a first run on its way to setup: an empty night field, not a light placeholder.
  if (isSetupBoot()) return <div className="app-boot" aria-busy="true" aria-label="Loading" />
  return (
    <div className="app-loading" aria-busy="true" aria-label="Loading">
      <Skeleton height={200} shape="tile" />
    </div>
  )
}

/** Renders the app only once the on-device database opens; otherwise explains what to do. */
function StorageGate({ children }: { children: ReactNode }) {
  const core = useCore()
  const [state, setState] = useState<'checking' | 'ok' | 'failed'>('checking')
  useEffect(() => {
    let cancelled = false
    void checkStorage(core.db).then((ok) => {
      if (!cancelled) setState(ok ? 'ok' : 'failed')
    })
    return () => {
      cancelled = true
    }
  }, [core])
  if (state === 'checking') return <Loading />
  if (state === 'failed') return <StorageUnavailableScreen />
  return children
}

/**
 * Home, or first-run setup for a new owner. Only Home decides: share links and
 * deep-link captures open their own screens and never pass through here.
 */
function HomeRoute() {
  const core = useCore()
  const settings = useSettings()
  const items = useItems()
  const lists = useSharedLists()
  const guests = useGuestLists()
  const [, navigate] = useLocation()
  const dbName = core.db.name
  const decided = settings !== undefined && items !== undefined && lists !== undefined && guests !== undefined
  const step = decided ? onboardingStepFor({ stored: settings.onboarding, items: items.length, lists: lists.length, guests: guests.length }) : null
  useEffect(() => {
    if (!decided) return
    // Home may decide after a share from another app has already opened Add a wish (Android, first
    // launch): then it is no longer on screen and must not send the person to setup over the form.
    if (!/^#?\/?$/.test(window.location.hash)) return
    const to = homeRedirect(step, peekCaptureDraft() !== null)
    if (to) navigate(to, { replace: true })
    else writeSetupHint(true, dbName)
  }, [decided, step, navigate, dbName])
  // Returning people see Home at once; a first visit waits for the answer instead of flashing Home.
  const waiting = Boolean(step) || (!decided && !readSetupHint(core.db.name))
  useLayoutEffect(() => {
    if (!waiting) endBoot()
  }, [waiting])
  if (waiting) return <Loading />
  return <HomeScreen />
}

/**
 * A transfer link opened while Hippo was already running (`#/t/<payload>`): the payload goes to
 * memory and the address is replaced at once, before the receive screen shows.
 */
function TransferLinkRoute() {
  const [, navigate] = useLocation()
  useLayoutEffect(() => {
    takeTransferFromLocation()
    navigate('/move/receive', { replace: true })
  }, [navigate])
  return null
}

export function Routes() {
  const epoch = useRouteEpoch()
  return (
    <Suspense fallback={<Loading />}>
      <Switch key={epoch}>
        <Route path="/" component={HomeRoute} />
        <Route path="/wishlist" component={WishlistScreen} />
        <Route path="/item/new">{() => <ItemEditorScreen />}</Route>
        <Route path="/item/:id">{(p) => <ItemEditorScreen id={p.id} />}</Route>
        <Route path="/lists" component={ListsScreen} />
        <Route path="/list/new">{() => <ListEditorScreen />}</Route>
        <Route path="/list/:id">{(p) => <ListEditorScreen id={p.id} />}</Route>
        <Route path="/l/:payload">{(p) => <GiverLinkScreen payload={p.payload} />}</Route>
        <Route path="/g/:topic">{(p) => <GiverScreen topic={p.topic} />}</Route>
        <Route path="/settings">{() => <SettingsScreen />}</Route>
        <Route path="/welcome/:step">{(p) => <OnboardingScreen step={p.step} />}</Route>
        <Route path="/existing">{() => <ExistingScreen />}</Route>
        <Route path="/move">{() => <MoveScreen />}</Route>
        <Route path="/move/receive">{() => <ReceiveScreen />}</Route>
        <Route path="/t/:payload" component={TransferLinkRoute} />
        <Route path="/site">{() => (isNativeApp() ? <SiteScreen /> : <NotFoundScreen />)}</Route>
        <Route path="/design" component={GalleryScreen} />
        <Route component={NotFoundScreen} />
      </Switch>
    </Suspense>
  )
}

export function App({ core }: { core?: Core }) {
  return (
    <CoreProvider {...(core ? { core } : {})}>
      <NotifyProvider>
        <ErrorBoundary>
          <StorageGate>
            <Router hook={useMotionLocation}>
              <ThemeSync />
              <InstallRecorder />
              <ClockNotice />
              <RouteFocus />
              <BootFlag />
              <DocumentTitle />
              <Routes />
              {import.meta.env.PROD && !__HIPPO_NATIVE__ && 'serviceWorker' in navigator ? (
                <Suspense fallback={null}>
                  <UpdatePrompt />
                </Suspense>
              ) : null}
            </Router>
          </StorageGate>
        </ErrorBoundary>
      </NotifyProvider>
    </CoreProvider>
  )
}
