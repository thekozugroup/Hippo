// A synchronous hint that first-run setup is behind this person, mirrored
// from the database (core settings `onboarding`, the source of truth) so a
// returning owner sees Home on the first frame instead of a loading state.

const KEY = 'hippo:setup'

export function readSetupHint(): boolean {
  try {
    return localStorage.getItem(KEY) === 'done'
  } catch {
    return false
  }
}

export function writeSetupHint(done: boolean): void {
  try {
    if (done) localStorage.setItem(KEY, 'done')
    else localStorage.removeItem(KEY)
  } catch {
    // Storage unavailable: Home waits for the database instead.
  }
}
