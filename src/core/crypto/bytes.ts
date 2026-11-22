import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

export { bytesToHex, hexToBytes }

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

/** 16 random bytes, lowercase hex (PROTOCOL.md section 1). */
export function randomId(): string {
  return bytesToHex(randomBytes(16))
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/** Strict UTF-8 decode: invalid sequences throw instead of becoming U+FFFD. */
export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function encode(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]! + alphabet[(n >> 6) & 63]! + alphabet[n & 63]!
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]! + (pad ? '==' : '')
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8)
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]! + alphabet[(n >> 6) & 63]! + (pad ? '=' : '')
  }
  return out
}

function decode(input: string, alphabet: string, padded: boolean): Uint8Array {
  let s = input
  if (padded) {
    if (s.length % 4 !== 0) throw new Error('invalid base64 length')
    if (s.endsWith('==')) s = s.slice(0, -2)
    else if (s.endsWith('=')) s = s.slice(0, -1)
  }
  if (s.length % 4 === 1) throw new Error('invalid base64 length')
  const lookup = new Map<string, number>()
  for (let i = 0; i < alphabet.length; i++) lookup.set(alphabet[i]!, i)
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let buffer = 0
  let bits = 0
  let o = 0
  for (const ch of s) {
    const v = lookup.get(ch)
    if (v === undefined) throw new Error('invalid base64 character')
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (buffer >> bits) & 0xff
    }
  }
  // Non-zero leftover bits mean a non-canonical encoding; reject so one
  // payload has exactly one textual form.
  if ((buffer & ((1 << bits) - 1)) !== 0) throw new Error('non-canonical base64')
  return out
}

export function base64Encode(bytes: Uint8Array): string {
  return encode(bytes, B64, true)
}

export function base64Decode(s: string): Uint8Array {
  return decode(s, B64, true)
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return encode(bytes, B64URL, false)
}

export function base64UrlDecode(s: string): Uint8Array {
  return decode(s, B64URL, false)
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}
