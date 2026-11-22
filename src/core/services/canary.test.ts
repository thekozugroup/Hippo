// @vitest-environment node
import { verifyEvent } from 'nostr-tools/pure'
import { describe, expect, it } from 'vitest'
import { deriveContentKeys, generateListSecret } from '../crypto/keys.ts'
import { buildCanaryEvent, canaryPubkey, canarySecretKey, canarySlot, canaryTargets, canaryTopic, isoWeek, isoWeekAgo } from './canary.ts'

describe('isoWeek', () => {
  it.each([
    ['2026-11-22T12:00:00Z', '2026-W47'],
    ['2026-11-23T00:00:00Z', '2026-W48'],
    ['2026-01-01T00:00:00Z', '2026-W01'],
    ['2021-01-03T00:00:00Z', '2020-W53'],
    ['2024-12-30T00:00:00Z', '2025-W01'],
    ['2026-12-31T23:59:59Z', '2026-W53'],
  ])('%s is %s', (iso, week) => {
    expect(isoWeek(new Date(iso))).toBe(week)
  })

  it('goes back whole weeks across a year boundary', () => {
    expect(isoWeekAgo(new Date('2026-01-05T00:00:00Z'), 2)).toBe('2025-W52')
    expect(isoWeekAgo(new Date('2026-11-22T00:00:00Z'), 12)).toBe('2026-W35')
  })
})

describe('canary derivation', () => {
  it('is deterministic per week', () => {
    expect(canarySecretKey('2026-W47')).toEqual(canarySecretKey('2026-W47'))
    expect(canaryPubkey('2026-W47')).toBe(canaryPubkey('2026-W47'))
  })

  it('differs across weeks in key, topic and slot', () => {
    expect(canaryPubkey('2026-W47')).not.toBe(canaryPubkey('2026-W46'))
    expect(canaryTopic('2026-W47')).not.toBe(canaryTopic('2026-W46'))
    expect(canarySlot('2026-W47')).not.toBe(canarySlot('2026-W46'))
  })

  it('never looks like a real topic or slot', () => {
    const real = deriveContentKeys(generateListSecret()).topic
    expect(real).toMatch(/^[0-9a-f]{64}$/)
    for (const w of ['2026-W01', '2026-W47', '2030-W53']) {
      expect(canaryTopic(w)).not.toMatch(/^[0-9a-f]{64}$/)
      expect(canaryTopic(w)).not.toBe(real)
      expect(canarySlot(w)).not.toMatch(/^hippo:[0-9a-f]{64}:/)
    }
  })

  it('rejects a malformed week', () => {
    expect(() => canarySecretKey('2026-47')).toThrow()
    expect(() => canaryTopic('x')).toThrow()
  })
})

describe('buildCanaryEvent', () => {
  const now = 1_795_000_000
  const ev = buildCanaryEvent('2026-W47', now)

  it('is a valid signed kind 30078 event by the week key', () => {
    expect(ev.kind).toBe(30078)
    expect(ev.pubkey).toBe(canaryPubkey('2026-W47'))
    expect(verifyEvent(ev)).toBe(true)
  })

  it('carries exactly d, t and a 100 day expiration', () => {
    expect(ev.tags).toEqual([
      ['d', canarySlot('2026-W47')],
      ['t', canaryTopic('2026-W47')],
      ['expiration', String(now + 100 * 86400)],
    ])
  })

  it('has opaque random content of realistic size, different each time', () => {
    expect(ev.content.length).toBeGreaterThan(900)
    expect(ev.content.length).toBeLessThan(1200)
    expect(buildCanaryEvent('2026-W47', now).content).not.toBe(ev.content)
  })
})

describe('canaryTargets', () => {
  it('lists the 1, 4 and 12 weeks ago canaries with their own keys', () => {
    const t = canaryTargets(new Date('2026-11-22T00:00:00Z'))
    expect(t.map((x) => x.weeksAgo)).toEqual([1, 4, 12])
    expect(t.map((x) => x.week)).toEqual(['2026-W46', '2026-W43', '2026-W35'])
    expect(new Set(t.map((x) => x.pubkey)).size).toBe(3)
    expect(t[0]?.pubkey).toBe(canaryPubkey('2026-W46'))
  })
})
