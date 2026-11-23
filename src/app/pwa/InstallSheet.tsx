// The install guidance in a sheet, opened from the Home "Get set up" checklist.
// Loaded on first use.

import { BottomSheet } from '../../ui/index.ts'
import { installTaskName, moveWishesNote, whyInstall, type InstallGuide as Guide } from './guide.ts'
import { InstallGuide } from './InstallGuide.tsx'

export default function InstallSheet({ open, onClose, guide, installed }: { open: boolean; onClose: () => void; guide: Guide; installed: boolean }) {
  const move = moveWishesNote(guide)
  return (
    <BottomSheet open={open} onClose={onClose} title={installTaskName(guide)} description={whyInstall(guide)}>
      <InstallGuide guide={guide} installed={installed}>
        {move ? <p className="install-guide__note">{move}</p> : null}
      </InstallGuide>
    </BottomSheet>
  )
}
