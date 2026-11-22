/**
 * Builds `aria-describedby` for a control from its error and hint ids, then any ids the caller
 * passed themselves (merged, never overwritten).
 */
export function describedBy(id: string, hint?: string, error?: string, extra?: string): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null, extra?.trim() || null].filter(Boolean)
  return ids.length ? ids.join(' ') : undefined
}

/** `aria-invalid` is true when there is an error text, otherwise whatever the caller passed. */
export function invalidState<T>(error: string | undefined, passed: T): true | T {
  return error ? true : passed
}
