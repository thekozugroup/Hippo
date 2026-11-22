/** PROTOCOL.md section 7. A v1 share link means "these relays". */
export const DEFAULT_RELAYS: readonly string[] = [
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://relay.nostr.net',
  'wss://relay.damus.io',
  'wss://nos.lol',
]

/**
 * sessionStorage key (comma-separated loopback relay URLs) that forces every
 * transport onto the given relays, ignoring list and link relays. Meant for
 * end-to-end tests against the mock relay; see README. Session-scoped, so a
 * crafted link cannot change the app beyond the tab it was opened in.
 */
export const RELAY_FORCE_STORAGE_KEY = 'hippo:relays'

/** URL query parameter with the same effect; `applyRelayOverrideFromUrl` copies it into sessionStorage. */
export const RELAY_FORCE_QUERY_PARAM = 'relays'

export function sameRelaySet(a: readonly string[], b: readonly string[]): boolean {
  const norm = (r: string): string => r.replace(/\/+$/, '').toLowerCase()
  const sa = new Set(a.map(norm))
  const sb = new Set(b.map(norm))
  return sa.size === sb.size && [...sa].every((r) => sb.has(r))
}
