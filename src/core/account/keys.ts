// Account keys, PROTOCOL.md section 12.1. One random 16-byte secret (the recovery code) gives a
// signing key, a content key, a topic and a slot key through HKDF. The salt "hippo-account/v1"
// differs from every other derivation ("hippo/v1" for lists, "hippo-transfer/v1" for transfers),
// so no account value can equal a list or transfer value.

import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes, randomBytes, utf8Encode } from '../crypto/bytes.ts'
import { isHex } from '../model/guards.ts'

export const ACCOUNT_SECRET_BYTES = 16
const SALT = utf8Encode('hippo-account/v1')

export interface AccountKeys {
  /** secp256k1 secret key, hex. Signs every record event. */
  secretKey: string
  /** Its x-only public key, hex: the only author whose records are accepted. */
  pubkey: string
  /** XChaCha20-Poly1305 key for record payloads. */
  contentKey: Uint8Array
  /** Opaque routing tag the sync servers can index (hex). */
  topic: string
  /** Turns a record's type and id into its opaque slot. */
  slotKey: Uint8Array
}

export function isAccountSecret(value: unknown): value is string {
  return isHex(value, ACCOUNT_SECRET_BYTES)
}

export function generateAccountSecret(): string {
  return bytesToHex(randomBytes(ACCOUNT_SECRET_BYTES))
}

function derive(ikm: Uint8Array, info: string): Uint8Array {
  return hkdf(sha256, ikm, SALT, utf8Encode(info), 32)
}

const cache = new Map<string, AccountKeys>()

export function deriveAccountKeys(secretHex: string): AccountKeys {
  if (!isAccountSecret(secretHex)) throw new Error('account secret must be 16 bytes hex')
  const hit = cache.get(secretHex)
  if (hit) return hit
  const ikm = hexToBytes(secretHex)
  // A 32-byte HKDF output is a valid scalar except with negligible probability; try the next label then.
  let sk = derive(ikm, 'sign')
  for (let i = 1; !secp256k1.utils.isValidSecretKey(sk); i++) sk = derive(ikm, `sign/${i}`)
  const keys: AccountKeys = {
    secretKey: bytesToHex(sk),
    pubkey: getPublicKey(sk),
    contentKey: derive(ikm, 'content'),
    topic: bytesToHex(derive(ikm, 'topic')),
    slotKey: derive(ikm, 'slot'),
  }
  if (cache.size > 8) cache.clear()
  cache.set(secretHex, keys)
  return keys
}

/** `hex(HMAC-SHA256(slotKey, type ":" id)[0..16])`: the record's slot, unlinkable to its type or id without the secret. */
export function recordSlotId(slotKey: Uint8Array, type: string, id: string): string {
  return bytesToHex(hmac(sha256, slotKey, utf8Encode(`${type}:${id}`)).subarray(0, 16))
}
