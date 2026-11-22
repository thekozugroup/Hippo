import type { ReactNode } from 'react'
import { ArrowLeft, Gift, House, ListChecks, Settings } from 'lucide-react'
import { BottomNav, IconLink, Logo, Screen, TopBar, cx } from '../../ui/index.ts'
import './AppScreen.css'

export type NavId = 'home' | 'wishlist' | 'lists' | 'settings'

const NAV = [
  { id: 'home', label: 'Home', icon: <House />, href: '#/' },
  { id: 'wishlist', label: 'Wishlist', icon: <Gift />, href: '#/wishlist' },
  { id: 'lists', label: 'Lists', icon: <ListChecks />, href: '#/lists' },
  { id: 'settings', label: 'Settings', icon: <Settings />, href: '#/settings' },
] as const

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
  /** Main navigation; omitted on editors and the giver view. */
  nav?: NavId
  /** Busy state for the sheet (announced to assistive tech). */
  busy?: boolean
  children: ReactNode
}

/** Hero with top bar and h1, the sheet as `main`, and the floating nav. */
export function AppScreen({ title, compactTitle, intro, back, backLabel = 'Back', actions, nav, busy, children }: AppScreenProps) {
  return (
    <Screen
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
      nav={nav ? <BottomNav items={NAV} activeId={nav} label="Main" /> : undefined}
    >
      <div className="app-sheet" aria-busy={busy || undefined}>
        {children}
      </div>
    </Screen>
  )
}
