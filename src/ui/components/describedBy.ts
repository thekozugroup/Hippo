/** Builds `aria-describedby` for a control from its hint and error ids. */
export function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean)
  return ids.length ? ids.join(' ') : undefined
}
