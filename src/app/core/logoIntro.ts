// The large-logo intro on the first setup step plays once per device. A synchronous flag (like
// setupHint.ts), because the first frame has to know whether to start it.

const KEY = 'hippo:logoIntro'

export function shouldPlayLogoIntro(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'played'
  } catch {
    return false
  }
}

export function markLogoIntroPlayed(): void {
  try {
    localStorage.setItem(KEY, 'played')
  } catch {
    // Storage unavailable: the intro is skipped next time too (see shouldPlayLogoIntro).
  }
}
