// React bindings for installing: this device's guide (kept current as the
// browser offers its install prompt), running that prompt, and copying
// Hippo's address. Small and icon-free, so Home can load it with the app.

import { useEffect, useState } from 'react'
import { useNotify } from '../core/notify.ts'
import { appBaseUrl } from '../lib/capture-tools.ts'
import { installGuideFor, readInstallEnv, type InstallGuide as Guide } from './guide.ts'
import { canPromptInstall, onInstallChange, promptInstall, wasInstalledHere } from './install.ts'

function readGuide(): { guide: Guide; installedHere: boolean } {
  return { guide: installGuideFor(readInstallEnv(canPromptInstall())), installedHere: wasInstalledHere() }
}

/** This device's guide, kept current as the browser offers (or uses up) its install prompt, plus whether Hippo was just installed. */
export function useInstallGuide(): { guide: Guide; installedHere: boolean } {
  const [state, setState] = useState(readGuide)
  useEffect(() => onInstallChange(() => setState(readGuide())), [])
  return state
}

/** What to say once the browser's prompt was accepted. */
export function installedMessage(g: Pick<Guide, 'platform'>): string {
  return g.platform === 'android' ? 'Hippo is installed. Open it from your home screen.' : 'Hippo is installed. Open it from your apps.'
}

/** Runs the browser's install prompt and announces the outcome. A dismissed prompt says nothing. */
export function useInstallAction(guide: Pick<Guide, 'platform'>): { install: () => Promise<boolean>; busy: boolean } {
  const notify = useNotify()
  const [busy, setBusy] = useState(false)
  const install = async () => {
    if (busy) return false
    setBusy(true)
    try {
      const ok = await promptInstall()
      if (ok) notify(installedMessage(guide))
      return ok
    } catch {
      return false
    } finally {
      setBusy(false)
    }
  }
  return { install, busy }
}

/** Copies Hippo's own address (origin and path, never a share link's secret) to the clipboard, and says what to do next. */
export function useCopyLink(): (g: Pick<Guide, 'realBrowser'>) => Promise<void> {
  const notify = useNotify()
  return async (g) => {
    try {
      await navigator.clipboard.writeText(appBaseUrl())
      notify(`Link copied. Open ${g.realBrowser} and paste it.`)
    } catch {
      notify(`Copy did not work here. Open ${g.realBrowser} and type the address shown.`)
    }
  }
}
