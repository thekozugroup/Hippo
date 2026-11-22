/** JSON with object keys sorted, so payload comparisons do not depend on key order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k]
    return sorted
  })
}

const queues = new Map<string, Promise<unknown>>()

/**
 * Runs `fn` after every earlier call with the same key has settled. Publishing
 * the same slot twice in parallel could otherwise sign two events with the
 * same created_at.
 */
export function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return run
}
