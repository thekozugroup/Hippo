// A synchronous hint that first-run setup is behind this person, mirrored
// from the database (core settings `onboarding`, the source of truth) so a
// returning owner sees Home on the first frame instead of a loading state.
//
// The hint names the database it describes. A hint left over from another
// database (cleared site data that kept localStorage, or each test's own
// database) is ignored, so it can never show Home to a first-time visitor.

const KEY = 'hippo:setup'

export function readSetupHint(dbName: string): boolean {
  try {
    return localStorage.getItem(KEY) === `done:${dbName}`
  } catch {
    return false
  }
}

export function writeSetupHint(done: boolean, dbName: string): void {
  try {
    if (done) localStorage.setItem(KEY, `done:${dbName}`)
    else localStorage.removeItem(KEY)
  } catch {
    // Storage unavailable: Home waits for the database instead.
  }
}
