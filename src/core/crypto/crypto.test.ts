// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptJson, encryptJson, padPlaintext } from './aead.ts'
import {
  base64Decode,
  base64Encode,
  base64UrlDecode,
  base64UrlEncode,
  bytesToHex,
  randomBytes,
  randomId,
  utf8Encode,
} from './bytes.ts'
import { deriveContentKeys, deriveListKeys, generateListSecret, generateSigningKey, isValidPubkey, publicKeyOf } from './keys.ts'
import { buildShareUrl, decodeSharePayload, encodeSharePayload, parseShareLink } from './link.ts'
import { isHippoError } from '../errors.ts'

describe('bytes', () => {
  it('round trips base64 and base64url for every length', () => {
    for (let n = 0; n < 70; n++) {
      const b = randomBytes(n)
      expect(base64Decode(base64Encode(b))).toEqual(b)
      expect(base64UrlDecode(base64UrlEncode(b))).toEqual(b)
    }
  })

  it('matches the platform base64 encoder', () => {
    const b = randomBytes(100)
    expect(base64Encode(b)).toBe(Buffer.from(b).toString('base64'))
    expect(base64UrlEncode(b)).toBe(Buffer.from(b).toString('base64url'))
  })

  it('rejects invalid and non-canonical base64', () => {
    expect(() => base64Decode('abc')).toThrow()
    expect(() => base64Decode('ab$=')).toThrow()
    expect(() => base64UrlDecode('a')).toThrow()
    expect(() => base64UrlDecode('ab+/')).toThrow()
    // "QR" decodes to "A" with non-zero trailing bits; canonical form is "QQ".
    expect(() => base64UrlDecode('QR')).toThrow()
    expect(base64UrlDecode('QQ')).toEqual(new Uint8Array([65]))
  })

  it('generates 16-byte lowercase hex ids', () => {
    const id = randomId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(randomId()).not.toBe(id)
  })
})

describe('keys', () => {
  it('derives deterministic, distinct keys from the list secret', () => {
    const secret = generateListSecret()
    const a = deriveListKeys(secret)
    const b = deriveListKeys(secret)
    expect(a.topic).toBe(b.topic)
    expect(a.contentKey).toEqual(b.contentKey)
    expect(bytesToHex(a.contentKey)).not.toBe(bytesToHex(a.claimsKey))
    expect(a.topic).toMatch(/^[0-9a-f]{64}$/)
    expect(deriveListKeys(generateListSecret()).topic).not.toBe(a.topic)
  })

  it('owner keys do not include the claims key', () => {
    const k = deriveContentKeys(generateListSecret())
    expect(Object.keys(k).sort()).toEqual(['contentKey', 'slotKey', 'topic'])
  })

  it('matches a fixed HKDF-SHA256 vector', () => {
    // HKDF computed independently from Node's HMAC: PRK = HMAC(salt, ikm), T1 = HMAC(PRK, info || 0x01).
    const secret = '00'.repeat(32)
    const prk = createHmac('sha256', 'hippo/v1').update(Buffer.alloc(32)).digest()
    const okm = createHmac('sha256', prk).update(Buffer.concat([Buffer.from('topic'), Buffer.from([1])])).digest('hex')
    expect(deriveListKeys(secret).topic).toBe(okm)
  })

  it('validates public keys', () => {
    expect(isValidPubkey(publicKeyOf(generateSigningKey()))).toBe(true)
    expect(isValidPubkey('00'.repeat(32))).toBe(false)
    expect(isValidPubkey('zz')).toBe(false)
  })
})

describe('aead', () => {
  const key = randomBytes(32)
  const aad = 'hippo:abc:meta'

  it('round trips JSON', () => {
    const value = { v: 1, name: 'Birthday 🎂', n: [1, 2, 3] }
    expect(decryptJson(key, encryptJson(key, value, aad), aad)).toEqual(value)
  })

  it('pads plaintext to multiples of 256 bytes', () => {
    expect(padPlaintext(new Uint8Array(1)).length).toBe(256)
    expect(padPlaintext(new Uint8Array(256)).length).toBe(256)
    expect(padPlaintext(new Uint8Array(257)).length).toBe(512)
    const p = padPlaintext(utf8Encode('{}'))
    expect(p[2]).toBe(0x20)
    expect(p[255]).toBe(0x20)
    // base64(24 nonce + 256 ciphertext + 16 tag)
    expect(base64Decode(encryptJson(key, { a: 1 }, aad)).length).toBe(24 + 256 + 16)
    expect(base64Decode(encryptJson(key, { a: 'x'.repeat(300) }, aad)).length).toBe(24 + 512 + 16)
  })

  it('uses a fresh nonce each time', () => {
    expect(encryptJson(key, { a: 1 }, aad)).not.toBe(encryptJson(key, { a: 1 }, aad))
  })

  it('detects tampering', () => {
    const raw = base64Decode(encryptJson(key, { a: 1 }, aad))
    for (const i of [0, 30, raw.length - 1]) {
      const t = raw.slice()
      t[i] = (t[i] ?? 0) ^ 1
      expect(decryptJson(key, base64Encode(t), aad)).toBeNull()
    }
  })

  it('binds ciphertext to its slot via AAD', () => {
    const c = encryptJson(key, { a: 1 }, aad)
    expect(decryptJson(key, c, 'hippo:abc:item:00')).toBeNull()
  })

  it('rejects the wrong key and garbage', () => {
    const c = encryptJson(key, { a: 1 }, aad)
    expect(decryptJson(randomBytes(32), c, aad)).toBeNull()
    expect(decryptJson(key, 'not base64!', aad)).toBeNull()
    expect(decryptJson(key, '', aad)).toBeNull()
    expect(decryptJson(key, 'A'.repeat(100_000), aad)).toBeNull()
  })
})

describe('share link', () => {
  const ownerPubkey = publicKeyOf(generateSigningKey())
  const listSecret = generateListSecret()

  it('round trips v1 and v2', () => {
    const v1 = encodeSharePayload({ ownerPubkey, listSecret })
    expect(base64UrlDecode(v1).length).toBe(65)
    expect(base64UrlDecode(v1)[0]).toBe(1)
    expect(decodeSharePayload(v1)).toEqual({ ownerPubkey, listSecret })
    const relays = ['wss://relay.example.com', 'wss://nos.lol:8443/path']
    const v2 = encodeSharePayload({ ownerPubkey, listSecret, relays })
    expect(base64UrlDecode(v2)[0]).toBe(2)
    expect(decodeSharePayload(v2)).toEqual({ ownerPubkey, listSecret, relays })
  })

  it('builds and parses full URLs', () => {
    const payload = encodeSharePayload({ ownerPubkey, listSecret })
    const url = buildShareUrl('https://me.github.io/hippo?x=1#/home', payload)
    expect(url).toBe(`https://me.github.io/hippo/#/l/${payload}`)
    expect(parseShareLink(url)).toEqual({ ownerPubkey, listSecret })
    expect(parseShareLink(`  ${payload} `)).toEqual({ ownerPubkey, listSecret })
  })

  const bad = (bytes: number[] | Uint8Array): string => base64UrlEncode(new Uint8Array(bytes))
  const pk = Array.from(Buffer.from(ownerPubkey, 'hex'))
  const sk = Array.from(Buffer.from(listSecret, 'hex'))

  it.each([
    ['empty', ''],
    ['unknown version', bad([3, ...pk, ...sk])],
    ['version 0', bad([0, ...pk, ...sk])],
    ['v1 too short', bad([1, ...pk, ...sk.slice(1)])],
    ['v1 too long', bad([1, ...pk, ...sk, 0])],
    ['v2 without relays', bad([2, ...pk, ...sk])],
    ['v2 bad utf8', bad([2, ...pk, ...sk, 0xff, 0xfe])],
    ['v2 http relay', bad([2, ...pk, ...sk, ...utf8Encode('https://relay.example.com')])],
    ['v2 plain ws remote', bad([2, ...pk, ...sk, ...utf8Encode('ws://relay.example.com')])],
    ['v2 loopback ws relay', bad([2, ...pk, ...sk, ...utf8Encode('ws://127.0.0.1:7447')])],
    ['v2 loopback wss relay', bad([2, ...pk, ...sk, ...utf8Encode('wss://127.0.0.1:7447')])],
    ['v2 localhost relay', bad([2, ...pk, ...sk, ...utf8Encode('wss://localhost')])],
    ['v2 private relay', bad([2, ...pk, ...sk, ...utf8Encode('wss://192.168.1.1')])],
    ['v2 link-local relay', bad([2, ...pk, ...sk, ...utf8Encode('wss://169.254.169.254')])],
    ['v2 .local relay', bad([2, ...pk, ...sk, ...utf8Encode('wss://router.local:8443')])],
    ['v2 IPv6 loopback relay', bad([2, ...pk, ...sk, ...utf8Encode('wss://[::1]')])],
    ['v2 IPv6 unique-local relay', bad([2, ...pk, ...sk, ...utf8Encode('wss://[fd00::1]')])],
    ['v2 single-label relay', bad([2, ...pk, ...sk, ...utf8Encode('wss://router')])],
    ['v2 relay with credentials', bad([2, ...pk, ...sk, ...utf8Encode('wss://u:p@relay.example.com')])],
    ['v2 empty relay entry', bad([2, ...pk, ...sk, ...utf8Encode('wss://a.example,')])],
    ['invalid pubkey', bad([1, ...new Array<number>(32).fill(0), ...sk])],
    ['non base64url', 'abc+def'],
    ['padding', encodeSharePayload({ ownerPubkey, listSecret }) + '='],
    ['huge', 'A'.repeat(5000)],
  ])('rejects %s', (_name, payload) => {
    expect(() => decodeSharePayload(payload)).toThrow()
    try {
      decodeSharePayload(payload)
    } catch (e) {
      expect(isHippoError(e, 'invalid-link')).toBe(true)
    }
  })

  it('rejects text that is not a link', () => {
    expect(() => parseShareLink('https://example.com/some page')).toThrow()
  })
})
