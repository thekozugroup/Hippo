import { ExternalLink } from 'lucide-react'
import { cx } from '../../ui/index.ts'
import type { AppRoute } from '../lib/app-route.ts'
import { openInAppLink } from './open-in-app.ts'
import './OpenInAppLink.css'

/**
 * A quiet link that opens `route` in the Hippo Android app, or stays on this page when the app is
 * not installed. Render it only where `offersOpenInApp` says so (Android browsers).
 */
export function OpenInAppLink({ route, tone = 'sheet', className }: { route: AppRoute; tone?: 'sheet' | 'hero'; className?: string }) {
  return (
    <a className={cx('open-in-app', `open-in-app--${tone}`, className)} href={openInAppLink(route)} data-open-in-app="">
      <ExternalLink aria-hidden="true" size={18} />
      <span>Open in the Hippo app</span>
    </a>
  )
}
