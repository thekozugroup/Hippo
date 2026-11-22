import { lazy, Suspense, useEffect, useRef } from 'react'
import { Route, Router, Switch, useLocation, type BaseLocationHook } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import type { Core } from '../core/index.ts'
import { Skeleton } from '../ui/index.ts'
import { CoreProvider } from './core/CoreProvider.tsx'
import { useSettings } from './core/data.ts'
import { NotifyProvider } from './core/NotifyProvider.tsx'
import { applyTheme } from './core/theme.ts'
import { GiverScreen } from './screens/giver/GiverScreen.tsx'
import { HomeScreen } from './screens/HomeScreen.tsx'
import { ItemEditorScreen } from './screens/ItemEditorScreen.tsx'
import { ListEditorScreen } from './screens/lists/ListEditorScreen.tsx'
import { ListsScreen } from './screens/lists/ListsScreen.tsx'
import { NotFoundScreen } from './screens/NotFoundScreen.tsx'
import { WishlistScreen } from './screens/WishlistScreen.tsx'

const SettingsScreen = lazy(() => import('./screens/settings/SettingsScreen.tsx'))
const GalleryScreen = lazy(() => import('./screens/GalleryScreen.tsx'))
const UpdatePrompt = lazy(() => import('./pwa/UpdatePrompt.tsx'))

/** Hash routing that ignores a `?query` inside the fragment (the gallery uses one). */
const useHashPath: BaseLocationHook = () => {
  const [location, navigate] = useHashLocation()
  return [location.split('?')[0] ?? '/', navigate]
}

/** Moves focus to the new screen's heading and scrolls to the top after navigation. */
function RouteFocus() {
  const [location] = useLocation()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    window.scrollTo(0, 0)
    const id = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(id)
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

export function Routes() {
  return (
    <Suspense fallback={<Loading />}>
      <Switch>
        <Route path="/" component={HomeScreen} />
        <Route path="/wishlist" component={WishlistScreen} />
        <Route path="/item/new">{() => <ItemEditorScreen />}</Route>
        <Route path="/item/:id">{(p) => <ItemEditorScreen id={p.id} />}</Route>
        <Route path="/lists" component={ListsScreen} />
        <Route path="/list/new">{() => <ListEditorScreen />}</Route>
        <Route path="/list/:id">{(p) => <ListEditorScreen id={p.id} />}</Route>
        <Route path="/l/:payload">{(p) => <GiverScreen source={{ kind: 'link', payload: p.payload }} />}</Route>
        <Route path="/g/:topic">{(p) => <GiverScreen source={{ kind: 'topic', topic: p.topic }} />}</Route>
        <Route path="/settings" component={SettingsScreen} />
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
        <Router hook={useHashPath}>
          <ThemeSync />
          <RouteFocus />
          <Routes />
          {import.meta.env.PROD && 'serviceWorker' in navigator ? (
            <Suspense fallback={null}>
              <UpdatePrompt />
            </Suspense>
          ) : null}
        </Router>
      </NotifyProvider>
    </CoreProvider>
  )
}
