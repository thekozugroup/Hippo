import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes, randomBytes, utf8Encode } from './bytes.ts'
import { isHex } from '../model/guards.ts'

const SALT = utf8Encode('hippo/v1')

function derive(listSecret: Uint8Array, info: string): Uint8Array {
  return hkdf(sha256, listSecret, SALT, utf8Encode(info), 32)
}

export interface ContentKeys {
  contentKey: Uint8Array
  topic: string
}

/** What the owner needs: content keys plus the key that maps local item ids to shared ones. */
export interface OwnerKeys extends ContentKeys {
  slotKey: Uint8Array
}

export interface ListKeys extends ContentKeys {
  claimsKey: Uint8Array
}

function secretBytes(listSecretHex: string): Uint8Array {
  if (!isHex(listSecretHex, 32)) throw new Error('listSecret must be 32 bytes hex')
  return hexToBytes(listSecretHex)
}

/**
 * Keys the owner needs. Deliberately excludes `claimsKey` so owner code
 * paths cannot decrypt claims even by mistake (PRD FR-17).
 */
export function deriveContentKeys(listSecretHex: string): OwnerKeys {
  const secret = secretBytes(listSecretHex)
  return {
    contentKey: derive(secret, 'content'),
    topic: bytesToHex(derive(secret, 'topic')),
    slotKey: derive(secret, 'slot'),
  }
}

/**
 * The id an item has inside one shared list: HMAC-SHA256(slotKey, localId)
 * truncated to 16 bytes, lowercase hex. The local wishlist id never leaves
 * the device, so the same wish in two lists (or before and after a
 * rotation) has unrelated ids on the wire.
 */
export function sharedItemIdWith(slotKey: Uint8Array, localItemId: string): string {
  if (!isHex(localItemId, 16)) throw new Error('item id must be 16 bytes hex')
  return bytesToHex(hmac(sha256, slotKey, hexToBytes(localItemId)).subarray(0, 16))
}

/** `sharedItemIdWith` for a list secret. */
export function sharedItemId(listSecretHex: string, localItemId: string): string {
  return sharedItemIdWith(derive(secretBytes(listSecretHex), 'slot'), localItemId)
}

/** All keys, for givers. */
export function deriveListKeys(listSecretHex: string): ListKeys {
  const secret = secretBytes(listSecretHex)
  return {
    contentKey: derive(secret, 'content'),
    claimsKey: derive(secret, 'claims'),
    topic: bytesToHex(derive(secret, 'topic')),
  }
}

export function topicForSecret(listSecretHex: string): string {
  return bytesToHex(derive(secretBytes(listSecretHex), 'topic'))
}

export function generateListSecret(): string {
  return bytesToHex(randomBytes(32))
}

export function generateSigningKey(): string {
  return bytesToHex(generateSecretKey())
}

export function publicKeyOf(secretKeyHex: string): string {
  if (!isHex(secretKeyHex, 32)) throw new Error('secret key must be 32 bytes hex')
  return getPublicKey(hexToBytes(secretKeyHex))
}

/** True when the 32-byte hex string is the x coordinate of a curve point (BIP-340). */
export function isValidPubkey(pubkeyHex: string): boolean {
  if (!isHex(pubkeyHex, 32)) return false
  try {
    schnorr.utils.lift_x(BigInt('0x' + pubkeyHex))
    return true
  } catch {
    return false
  }
}
