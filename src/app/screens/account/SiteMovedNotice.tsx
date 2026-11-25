// "This Hippo site now lives at <host>" on Home, once `useSiteMoved` (site-moved.ts) says it applies;
// the notice itself (and the device link code) loads only then.

import { lazy, Suspense } from 'react'
import type { SiteMoved } from './site-moved.ts'

const AddressNotice = lazy(() => import('./AddressNotice.tsx'))

export function SiteMovedNotice({ moved }: { moved: SiteMoved }) {
  return (
    <Suspense fallback={null}>
      <AddressNotice site={moved.site} onDismiss={moved.hide} />
    </Suspense>
  )
}
