import { hkdf } from '@noble/hashes/hkdf.js'
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
export function deriveContentKeys(listSecretHex: string): ContentKeys {
  const secret = secretBytes(listSecretHex)
  return { contentKey: derive(secret, 'content'), topic: bytesToHex(derive(secret, 'topic')) }
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
