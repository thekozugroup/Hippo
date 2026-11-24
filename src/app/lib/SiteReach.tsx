// The line shown beside a link when the app's Hippo site does not answer (see site-reach.ts).

import { hostLabel, useSiteAddress, useSiteReach } from './site-reach.ts'

/** One line beside a link when the site it points at does not answer (the app only). */
export function SiteReachNote({ id, what = 'this link' }: { id?: string; what?: string }) {
  const site = useSiteAddress()
  const reach = useSiteReach()
  if (reach !== 'unreachable') return null
  return (
    <p className="app-note app-note--warning" id={id} role="status" data-testid="site-unreachable">
      {`The Hippo site at ${hostLabel(site)} is not reachable yet, so ${what} will not open for other people until it is.`}
    </p>
  )
}
