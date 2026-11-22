// Share-link payload, PROTOCOL.md section 3.
//   v1: 0x01 || ownerPubkey(32) || listSecret(32)                (default relays)
//   v2: 0x02 || ownerPubkey(32) || listSecret(32) || utf8(relays joined by ",")

import { DEFAULT_RELAYS, sameRelaySet } from '../config.ts'
import { LIMITS } from '../model/limits.ts'
import { isRelayUrl } from '../model/validate.ts'
import { HippoError } from '../errors.ts'
import {
  base64UrlDecode,
  base64UrlEncode,
  bytesToHex,
  concatBytes,
  hexToBytes,
  utf8Decode,
  utf8Encode,
} from './bytes.ts'
import { isValidPubkey } from './keys.ts'
import { isHex } from '../model/guards.ts'

export interface SharePayload {
  ownerPubkey: string
  listSecret: string
  /** `undefined` means "use the default relays" (a v1 link). */
  relays?: string[]
}

const V1 = 0x01
const V2 = 0x02
const FIXED = 1 + 32 + 32
/** Keeps a hostile link from making us decode megabytes. */
const MAX_PAYLOAD_CHARS = 4096

export function encodeSharePayload(p: SharePayload): string {
  if (!isHex(p.ownerPubkey, 32) || !isHex(p.listSecret, 32)) {
    throw new HippoError('invalid-link', 'ownerPubkey and listSecret must be 32 bytes hex')
  }
  const keys = concatBytes(hexToBytes(p.ownerPubkey), hexToBytes(p.listSecret))
  if (p.relays === undefined) return base64UrlEncode(concatBytes(new Uint8Array([V1]), keys))
  validateRelays(p.relays)
  return base64UrlEncode(concatBytes(new Uint8Array([V2]), keys, utf8Encode(p.relays.join(','))))
}

function validateRelays(relays: string[]): void {
  if (relays.length === 0 || relays.length > LIMITS.relays) {
    throw new HippoError('invalid-link', 'relay list must have 1 to 20 entries')
  }
  // Public wss:// hosts only: a link must not point a giver's browser at
  // loopback, LAN or link-local services (see isRelayUrl).
  for (const r of relays) {
    if (r.length > LIMITS.relayUrl || !isRelayUrl(r)) throw new HippoError('invalid-link', 'invalid relay URL in link')
  }
}

/** Strict decoder: unknown versions, wrong lengths and bad relay lists all throw `invalid-link`. */
export function decodeSharePayload(payload: string): SharePayload {
  if (payload.length === 0 || payload.length > MAX_PAYLOAD_CHARS) {
    throw new HippoError('invalid-link', 'link payload has the wrong length')
  }
  let bytes: Uint8Array
  try {
    bytes = base64UrlDecode(payload)
  } catch {
    throw new HippoError('invalid-link', 'link payload is not valid base64url')
  }
  const version = bytes[0]
  if (version !== V1 && version !== V2) throw new HippoError('invalid-link', 'unknown link version')
  if (version === V1 && bytes.length !== FIXED) throw new HippoError('invalid-link', 'link payload has the wrong length')
  if (version === V2 && bytes.length <= FIXED) throw new HippoError('invalid-link', 'link payload has the wrong length')
  const ownerPubkey = bytesToHex(bytes.subarray(1, 33))
  const listSecret = bytesToHex(bytes.subarray(33, 65))
  if (!isValidPubkey(ownerPubkey)) throw new HippoError('invalid-link', 'owner key is not a valid public key')
  if (version === V1) return { ownerPubkey, listSecret }
  let text: string
  try {
    text = utf8Decode(bytes.subarray(FIXED))
  } catch {
    throw new HippoError('invalid-link', 'relay list is not valid UTF-8')
  }
  const relays = text.split(',')
  validateRelays(relays)
  return { ownerPubkey, listSecret, relays }
}

const FRAGMENT_PREFIX = '#/l/'

/** `https://host/base/` + `#/l/<payload>`. Any existing query or fragment on the base is dropped. */
export function buildShareUrl(appBaseUrl: string, payload: string): string {
  const u = new URL(appBaseUrl)
  u.hash = ''
  u.search = ''
  let base = u.toString()
  if (!base.endsWith('/')) base += '/'
  return base + FRAGMENT_PREFIX + payload
}

/**
 * Accepts a full share URL, a bare `#/l/<payload>` fragment, or the payload
 * itself (what a user might paste).
 */
export function extractSharePayload(input: string): string {
  const s = input.trim()
  const idx = s.indexOf(FRAGMENT_PREFIX)
  if (idx >= 0) return s.slice(idx + FRAGMENT_PREFIX.length)
  if (/^[A-Za-z0-9_-]+$/.test(s)) return s
  throw new HippoError('invalid-link', 'not a Hippo share link')
}

export function parseShareLink(input: string): SharePayload {
  return decodeSharePayload(extractSharePayload(input))
}

/** Full share link for keys and relays; a v1 payload when the relays are the defaults. */
export function shareLinkFor(p: { ownerPubkey: string; listSecret: string; relays: readonly string[] }, appBaseUrl: string): string {
  const payload = encodeSharePayload({
    ownerPubkey: p.ownerPubkey,
    listSecret: p.listSecret,
    ...(sameRelaySet(p.relays, DEFAULT_RELAYS) ? {} : { relays: [...p.relays] }),
  })
  return buildShareUrl(appBaseUrl, payload)
}
