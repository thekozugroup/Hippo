// The install guidance, built once and used by setup, the Home checklist and
// Settings: the device's own steps as a numbered list with a plain icon by
// each, the browser's install button where it offered one, and "Copy link"
// inside apps that cannot install. What to say comes from `guide.ts`.

import type { ReactNode } from 'react'
import { AppWindow, Check, Copy, Download, Ellipsis, EllipsisVertical, ExternalLink, Keyboard, Menu, MonitorDown, PanelBottom, Share, SquarePlus, Star } from 'lucide-react'
import { Button } from '../../ui/index.ts'
import { appBaseUrl } from '../lib/capture-tools.ts'
import type { GuideIcon, GuideText, InstallGuide as Guide } from './guide.ts'
import { installedMessage, useCopyLink, useInstallAction } from './useInstall.ts'
import './InstallGuide.css'

const ICONS: Record<GuideIcon, ReactNode> = {
  share: <Share />,
  'add-square': <SquarePlus />,
  'more-vertical': <EllipsisVertical />,
  more: <Ellipsis />,
  menu: <Menu />,
  install: <MonitorDown />,
  dock: <PanelBottom />,
  bookmark: <Star />,
  keyboard: <Keyboard />,
  copy: <Copy />,
  open: <ExternalLink />,
  check: <Check />,
  apps: <AppWindow />,
}

export function GuideWords({ text }: { text: GuideText }) {
  return (
    <>
      {text.map((part, i) => (typeof part === 'string' ? <span key={i}>{part}</span> : <strong key={i}>{part.term}</strong>))}
    </>
  )
}

export interface InstallGuideProps {
  guide: Guide
  /** Hippo was installed from this page. */
  installed?: boolean
  /** Show the guide's own buttons (Install Hippo, Copy link); setup puts them on the step's main button instead. */
  actions?: boolean
  /** The dark setup field or a light sheet. */
  tone?: 'hero' | 'sheet'
  /** Extra lines under the steps (Settings: moving wishes). */
  children?: ReactNode
}

/**
 * The steps for this device. Icons are decorative; the words name what the device shows, in bold.
 * Inside an app that cannot install, "Copy link" copies Hippo's own address (never a share link).
 */
export function InstallGuide({ guide, installed = false, actions = true, tone = 'sheet', children }: InstallGuideProps) {
  const { install, busy } = useInstallAction(guide)
  const done = installed || guide.kind === 'installed'
  const buttonVariant = tone === 'hero' ? 'frost' : 'secondary'

  const copyLink = useCopyLink()

  return (
    <div className={`install-guide install-guide--${tone}`}>
      {done ? (
        <p className="install-guide__done">
          <Check aria-hidden="true" className="install-guide__icon" />
          <span>{guide.kind === 'installed' ? 'Hippo is installed on this device.' : installedMessage(guide)}</span>
        </p>
      ) : (
        <>
          {guide.steps.length > 0 ? (
            <ol className="install-guide__steps">
              {guide.steps.map((s, i) => (
                <li key={i} className="install-guide__step">
                  <span className="install-guide__icon-wrap" aria-hidden="true">
                    {ICONS[s.icon]}
                  </span>
                  <span className="install-guide__text">
                    <GuideWords text={s.text} />
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          {guide.note ? (
            <p className="install-guide__note">
              <GuideWords text={guide.note} />
            </p>
          ) : null}
          {guide.kind === 'prompt' && actions ? (
            <div>
              <Button type="button" variant={buttonVariant} size="md" icon={<Download />} loading={busy} onClick={() => void install()}>
                Install Hippo
              </Button>
            </div>
          ) : null}
          {guide.kind === 'in-app' ? (
            <div className="install-guide__copy">
              {actions ? (
                <Button type="button" variant={buttonVariant} size="md" icon={<Copy />} onClick={() => void copyLink(guide)}>
                  Copy link
                </Button>
              ) : null}
              <span className="install-guide__url" translate="no">
                {appBaseUrl()}
              </span>
            </div>
          ) : null}
        </>
      )}
      {children}
    </div>
  )
}
