// "I already use Hippo", from the first setup step: the ways to bring an existing Hippo here
// instead of starting a new wishlist. Each choice has one line of plain explanation. Whatever comes
// in, setup is marked done and Home opens; no first list is made. Everything here is also in Settings.

import { type ReactNode } from 'react'
import { useLocation } from 'wouter'
import { ChevronRight, FileUp, Globe, KeyRound, Smartphone } from 'lucide-react'
import { StepScreen, TwoTone } from '../../../ui/index.ts'
import { BackupImport } from '../../lib/BackupImport.tsx'
import { isNativeApp } from '../../native/platform.ts'
import './move.css'

function Choice({ icon, title, line, onClick, busy }: { icon: ReactNode; title: string; line: string; onClick: () => void; busy?: boolean }) {
  return (
    <button type="button" className="existing-choice" onClick={onClick} aria-busy={busy || undefined}>
      <span className="existing-choice__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="existing-choice__text">
        <span className="existing-choice__title">{title}</span>
        <span className="existing-choice__line">{line}</span>
      </span>
      <ChevronRight className="existing-choice__chevron" aria-hidden="true" />
    </button>
  )
}

export default function ExistingScreen() {
  const [, navigate] = useLocation()
  const app = isNativeApp()
  return (
    <StepScreen
      title={<TwoTone tone="on-hero" muted="Bring your" bright="Hippo here" />}
      description={<p>Choose where your wishes are now. You can do this later in Settings too.</p>}
      onBack={() => window.history.back()}
      backLabel="Back to setup"
    >
      <div className="existing-choices" role="list">
        {/* Your Hippo account: sign in first, a file last. */}
        <div role="listitem">
          <Choice icon={<KeyRound />} title="Sign in with my recovery code" line="The 13 words you saved. Your wishes come here and stay in step." onClick={() => navigate('/account/sign-in')} />
        </div>
        <div role="listitem">
          <Choice icon={<Smartphone />} title="I have a link from my other device" line="Choose Add a device in Settings there, then open its link here." onClick={() => navigate('/move/receive')} />
        </div>
        <div role="listitem">
          <BackupImport mergeOnly onImported={() => navigate('/', { replace: true })}>
            {(pick, busy) => <Choice icon={<FileUp />} title="From a backup file" line="Pick the file you saved with Export backup." onClick={pick} busy={busy} />}
          </BackupImport>
        </div>
        {app ? (
          <div role="listitem">
            <Choice icon={<Globe />} title="Use my own Hippo site" line="For a Hippo website you run yourself, or one that moved to its own address." onClick={() => navigate('/site')} />
          </div>
        ) : null}
      </div>
    </StepScreen>
  )
}
