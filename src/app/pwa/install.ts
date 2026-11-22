// Install prompt (Android and desktop Chromium). The browser fires
// `beforeinstallprompt` once, early, so it is kept here (loaded with the app)
// for setup and Settings to offer later. Nothing is shown unless asked.

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

function isInstallPrompt(e: Event): e is InstallPromptEvent {
  return 'prompt' in e && typeof (e as { prompt?: unknown }).prompt === 'function'
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    if (!isInstallPrompt(e)) return
    e.preventDefault()
    deferred = e
    for (const l of listeners) l()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    for (const l of listeners) l()
  })
}

export function canPromptInstall(): boolean {
  return deferred !== null
}

export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Shows the browser's install prompt; resolves true when the person accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred
  if (!e) return false
  deferred = null
  await e.prompt()
  const choice = await e.userChoice
  for (const l of listeners) l()
  return choice.outcome === 'accepted'
}

export function isStandalone(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
}
