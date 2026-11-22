import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Route, Router, Switch, useLocation } from 'wouter'
import type { Core } from '../core/index.ts'
import { Skeleton } from '../ui/index.ts'
import { useCore } from './core/context.ts'
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
import './pwa/install.ts'

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
const GalleryScreen = lazy(() => import('./screens/GalleryScreen.tsx'))
const UpdatePrompt = lazy(() => import('./pwa/UpdatePrompt.tsx'))

function preloadFor(path: string): Promise<unknown> | undefined {
  if (path.startsWith('/item/')) return ItemEditorScreen.preload()
  if (path.startsWith('/list/')) return ListEditorScreen.preload()
  if (path.startsWith('/g/') || path.startsWith('/l/')) return GiverScreen.preload()
  if (path === '/settings') return SettingsScreen.preload()
  if (path.startsWith('/welcome/')) return OnboardingScreen.preload()
  return undefined
}
setRoutePreloader(preloadFor)

/** Moves focus to the new screen's heading and scrolls to the top after navigation. */
function RouteFocus() {
  const [location] = useLocation()
  const first = useRef(true)
  // Scroll before paint (inside a route transition's update), focus after it.
  useLayoutEffect(() => {
    if (first.current) return
    window.scrollTo(0, 0)
  }, [location])
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const id = window.requestAnimationFrame(() => {
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

function ThemeSync() {
  const settings = useSettings()
  const theme = settings?.theme
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])
  return null
}

function Loading() {
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
  const settings = useSettings()
  const items = useItems()
  const lists = useSharedLists()
  const guests = useGuestLists()
  const [, navigate] = useLocation()
  const decided = settings !== undefined && items !== undefined && lists !== undefined && guests !== undefined
  const step = decided ? onboardingStepFor({ stored: settings.onboarding, items: items.length, lists: lists.length, guests: guests.length }) : null
  useEffect(() => {
    if (!decided) return
    if (step) navigate(`/welcome/${step}`, { replace: true })
    else writeSetupHint(true)
  }, [decided, step, navigate])
  // Returning people see Home at once; a first visit waits for the answer instead of flashing Home.
  if (step || (!decided && !readSetupHint())) return <Loading />
  return <HomeScreen />
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
              <RouteFocus />
              <BootFlag />
              <DocumentTitle />
              <Routes />
              {import.meta.env.PROD && 'serviceWorker' in navigator ? (
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
