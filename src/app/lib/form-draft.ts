// Unsaved form drafts for this browser tab only (sessionStorage), so Back or
// a reload does not lose what someone typed. Never kept beyond the tab:
// closing it forgets them. Keys are per form ("item:new", "item:<id>").

const PREFIX = 'hippo:draft:'

function store(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

/** The saved draft (parsed JSON, still untrusted: validate it), or undefined. */
export function readFormDraft(key: string): unknown {
  try {
    const raw = store()?.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as unknown) : undefined
  } catch {
    return undefined
  }
}

export function writeFormDraft(key: string, value: unknown): void {
  try {
    store()?.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full or unavailable: the draft lasts as long as the form.
  }
}

export function clearFormDraft(key: string): void {
  try {
    store()?.removeItem(PREFIX + key)
  } catch {
    // Nothing to clear.
  }
}
