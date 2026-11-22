// XChaCha20-Poly1305 envelope, PROTOCOL.md section 2:
// content = base64(nonce(24) || ciphertext), plaintext = UTF-8 JSON padded
// with spaces to a multiple of 256 bytes, AAD = the event's `d` tag value.

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { LIMITS } from '../model/limits.ts'
import { base64Decode, base64Encode, concatBytes, randomBytes, utf8Decode, utf8Encode } from './bytes.ts'

export const PAD_BLOCK = 256
const NONCE_LENGTH = 24
const TAG_LENGTH = 16

export function padPlaintext(bytes: Uint8Array): Uint8Array {
  const size = Math.max(PAD_BLOCK, Math.ceil(bytes.length / PAD_BLOCK) * PAD_BLOCK)
  const out = new Uint8Array(size).fill(0x20)
  out.set(bytes)
  return out
}

export function encryptJson(key: Uint8Array, value: unknown, aad: string): string {
  const plaintext = padPlaintext(utf8Encode(JSON.stringify(value)))
  const nonce = randomBytes(NONCE_LENGTH)
  const ciphertext = xchacha20poly1305(key, nonce, utf8Encode(aad)).encrypt(plaintext)
  return base64Encode(concatBytes(nonce, ciphertext))
}

/**
 * Returns the parsed JSON value, or `null` on any failure (bad base64, wrong
 * key, wrong AAD, tampering, invalid UTF-8 or JSON). Never throws.
 */
export function decryptJson(key: Uint8Array, content: string, aad: string): unknown {
  if (content.length > LIMITS.content) return null
  try {
    const raw = base64Decode(content)
    if (raw.length < NONCE_LENGTH + TAG_LENGTH) return null
    const nonce = raw.subarray(0, NONCE_LENGTH)
    const plaintext = xchacha20poly1305(key, nonce, utf8Encode(aad)).decrypt(raw.subarray(NONCE_LENGTH))
    return JSON.parse(utf8Decode(plaintext)) as unknown
  } catch {
    return null
  }
}
