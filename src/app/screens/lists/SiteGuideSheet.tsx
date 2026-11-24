// The guided screen before a first share (Android app only): the people a list is shared with open it
// in a browser, so the app needs a web address that works. Shown when the built-in address does not
// answer or there is none. Closing it cancels the share; "Share anyway" carries on with the
// "not reachable yet" note. Loaded on demand (ListEditorScreen), so the website never downloads it.

import { BottomSheet } from '../../../ui/index.ts'
import { SiteSetup, type ConnectedSite } from '../move/SiteSetup.tsx'

export interface SiteGuideSheetProps {
  open: boolean
  /** Closed without sharing. */
  onClose: () => void
  /** An address was connected: share now. */
  onConnected: (site: ConnectedSite) => void
  /** Share with the address as it is. */
  onShareAnyway: () => void
}

export default function SiteGuideSheet({ open, onClose, onConnected, onShareAnyway }: SiteGuideSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Where will your list open?" data-testid="site-guide">
      <SiteSetup
        intro="The people you share with open your list in a web browser, so Hippo needs a web address for it. The one built in does not answer right now."
        onConnected={onConnected}
        skip={{ label: 'Share anyway', onSkip: onShareAnyway }}
      />
    </BottomSheet>
  )
}
