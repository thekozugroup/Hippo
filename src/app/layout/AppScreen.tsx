import type { ReactNode } from 'react'
import { ArrowLeft, Gift, House, ListChecks, Plus, Settings } from 'lucide-react'
import { BottomNav, IconLink, Logo, Screen, SideNav, TopBar, cx, useLayoutSize } from '../../ui/index.ts'
import { ClockNote } from '../core/ClockNotice.tsx'
import './AppScreen.css'

export type NavId = 'home' | 'wishlist' | 'lists' | 'settings'

const NAV = [
  { id: 'home', label: 'Home', icon: <House />, href: '#/' },
  { id: 'wishlist', label: 'Wishlist', icon: <Gift />, href: '#/wishlist' },
  { id: 'lists', label: 'Lists', icon: <ListChecks />, href: '#/lists' },
  { id: 'settings', label: 'Settings', icon: <Settings />, href: '#/settings' },
] as const

const ADD_WISH = { label: 'Add a wish', icon: <Plus />, href: '#/item/new' }

export interface AppScreenProps {
  /** Screen heading (the only h1). */
  title: ReactNode
  /** Smaller title style for long names (list names, item titles). */
  compactTitle?: boolean
  /** Extra hero content under the title (dates, messages, filters). */
  intro?: ReactNode
  /** Back link destination; when absent the logo links home. */
  back?: string
  backLabel?: string
  /** Trailing top-bar actions. */
  actions?: ReactNode
  /** Main navigation (the bottom navigation on phones, the side navigation on wider windows); omitted on editors and the giver view. */
  nav?: NavId
  /**
   * For screens opened from a destination (editors, moving, the site): the side navigation shows on
   * wider windows with this destination marked; phones show no navigation there, as before. The
   * giver view has neither, because people who open a shared list may not use Hippo themselves.
   */
  area?: NavId
  /**
   * How wide the page's content runs on wider windows: `narrow` (default) keeps text and forms at a
   * reading measure, start-aligned in the page column; `wide` uses the whole page column (grids,
   * two columns). Phones are the same either way.
   */
  width?: 'narrow' | 'wide'
  /** Busy state for the sheet (announced to assistive tech). */
  busy?: boolean
  children: ReactNode
}

/** Hero with top bar and h1, the sheet as `main`, and the navigation (bottom on phones, side on wider windows). */
export function AppScreen({ title, compactTitle, intro, back, backLabel = 'Back', actions, nav, area, width = 'narrow', busy, children }: AppScreenProps) {
  const section = nav ?? area
  // One navigation at a time: the bottom one on phones, the side one on wider windows (the CSS
  // hides the other as well, for the first frame of a resize).
  const compact = useLayoutSize() === 'compact'
  return (
    <Screen
      {...(section && !compact ? { rail: <SideNav items={NAV} activeId={section} label="Main" homeHref="#/" action={ADD_WISH} /> } : {})}
      hero={
        <TopBar
          start={
            back ? (
              <IconLink href={back} variant="frost" aria-label={backLabel} icon={<ArrowLeft />} />
            ) : (
              <a href="#/" className="app-logo-link" aria-label="Hippo home">
                <Logo size={30} />
              </a>
            )
          }
          end={actions}
        />
      }
      headline={
        <div className="app-hero">
          <h1 className={cx('app-hero__title', compactTitle ? 't-title' : 't-headline')} tabIndex={-1}>
            {title}
          </h1>
          {intro ? <div className="app-hero__intro">{intro}</div> : null}
        </div>
      }
      nav={nav && compact ? <BottomNav items={NAV} activeId={nav} label="Main" remember="main" /> : undefined}
    >
      <div className={cx('app-sheet', 'app-page', width === 'wide' ? 'app-page--wide' : 'app-page--narrow')} aria-busy={busy || undefined}>
        <ClockNote />
        {children}
      </div>
    </Screen>
  )
}
