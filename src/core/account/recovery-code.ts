// The recovery code, PROTOCOL.md section 12.2: the account secret as 13 English words.
//
// 128 secret bits followed by a 15-bit checksum (the first 15 bits of
// SHA-256("hippo-recovery/v1" || secret)) make 143 bits, read as 13 groups of 11 bits, each an
// index into the BIP-39 English word list (2048 words). Words are easy to read aloud and to copy
// by hand, every word is known by its first four letters (so a misspelt ending still works and a
// misspelt start is caught), and a wrong or swapped word is caught by the checksum, except with
// probability 1 in 32,768. Thirteen words is not a valid BIP-39 length on purpose: this is not a
// wallet phrase, and no wallet will take it as one.
//
// The word list is 6 kB compressed and is loaded only by the account screens.

import { sha256 } from '@noble/hashes/sha2.js'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { bytesToHex, concatBytes, hexToBytes, utf8Encode } from '../crypto/bytes.ts'
import { ACCOUNT_SECRET_BYTES, isAccountSecret } from './keys.ts'

export const RECOVERY_WORDS = 13
const CHECK_BITS = 15
const PREFIX = utf8Encode('hippo-recovery/v1')

function checksum(secret: Uint8Array): number {
  const h = sha256(concatBytes(PREFIX, secret))
  return (((h[0] ?? 0) << 16) | ((h[1] ?? 0) << 8) | (h[2] ?? 0)) >>> (24 - CHECK_BITS)
}

/** The 13 words for a secret. */
export function recoveryWords(secretHex: string): string[] {
  if (!isAccountSecret(secretHex)) throw new Error('not an account secret')
  const secret = hexToBytes(secretHex)
  let bits = 0n
  for (const b of secret) bits = (bits << 8n) | BigInt(b)
  bits = (bits << BigInt(CHECK_BITS)) | BigInt(checksum(secret))
  const out: string[] = []
  for (let i = RECOVERY_WORDS - 1; i >= 0; i--) out.push(wordlist[Number((bits >> BigInt(i * 11)) & 2047n)] ?? '')
  return out
}

export function formatRecoveryCode(secretHex: string): string {
  return recoveryWords(secretHex).join(' ')
}

export type RecoveryCodeProblem =
  /** Not 13 words. */
  | { reason: 'count'; count: number }
  /** A word that is not on the list (1-based position). */
  | { reason: 'word'; position: number; word: string }
  /** Every word is on the list, but they do not add up: one is wrong or two are swapped. */
  | { reason: 'checksum' }

export type RecoveryCodeResult = { ok: true; secret: string } | ({ ok: false } & RecoveryCodeProblem)

let index: Map<string, number> | null = null
function lookup(word: string): number | undefined {
  if (!index) {
    index = new Map()
    wordlist.forEach((w, i) => {
      index?.set(w, i)
      index?.set(w.slice(0, 4), i)
    })
  }
  return index.get(word) ?? (word.length >= 4 ? index.get(word.slice(0, 4)) : undefined)
}

/**
 * Reads a typed or pasted code: any case, any spacing or punctuation, numbers before words ("1.
 * apple") ignored, and each word by its first four letters. Strict about the rest.
 */
export function parseRecoveryCode(input: string): RecoveryCodeResult {
  const words = (typeof input === 'string' ? input.slice(0, 2000) : '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  if (words.length !== RECOVERY_WORDS) return { ok: false, reason: 'count', count: words.length }
  let bits = 0n
  for (const [i, w] of words.entries()) {
    const n = lookup(w)
    if (n === undefined) return { ok: false, reason: 'word', position: i + 1, word: w }
    bits = (bits << 11n) | BigInt(n)
  }
  const check = Number(bits & BigInt((1 << CHECK_BITS) - 1))
  let secretBits = bits >> BigInt(CHECK_BITS)
  const secret = new Uint8Array(ACCOUNT_SECRET_BYTES)
  for (let i = ACCOUNT_SECRET_BYTES - 1; i >= 0; i--) {
    secret[i] = Number(secretBits & 255n)
    secretBits >>= 8n
  }
  if (checksum(secret) !== check) return { ok: false, reason: 'checksum' }
  return { ok: true, secret: bytesToHex(secret) }
}
