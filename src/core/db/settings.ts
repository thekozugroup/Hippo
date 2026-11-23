// Typed key/value settings. Stored values are re-validated on read because
// IndexedDB contents can be stale from an older version or edited by hand.

import { LIMITS } from '../model/limits.ts'
import { codePointLength, isObject } from '../model/guards.ts'
import { isRelayUrl } from '../model/validate.ts'
import type { HippoDb } from './schema.ts'

export type Theme = 'system' | 'light' | 'dark'

/** One-time hints the app has shown on this device, and when Hippo was first seen installed (`appInstalled`). */
export type SeenFlag = 'giverIntro' | 'setupChecklist' | 'linkPreviewHint' | 'appInstalled'

/**
 * First-run setup progress. The app owns the meaning of `step` and the
 * answer keys; core only stores bounded values.
 */
export interface OnboardingState {
  status: 'active' | 'completed' | 'dismissed'
  /** Index of the current step, 0..19. */
  step: number
  /** Draft answers, keyed by the app (at most 12 keys, each value at most 300 characters). */
  answers: Record<string, string>
  /** The list and wish the flow created, so going back edits them instead of adding more. */
  listId?: string
  itemId?: string
  updatedAt: number
}

export interface Settings {
  /** Overrides the default relays for new shared lists and v1 links; undefined = defaults. */
  relays?: string[]
  theme: Theme
  lastExportAt?: number
  /** The owner's first name or nickname, shown to givers on shared lists (max 40 characters). */
  ownerName?: string
  onboarding?: OnboardingState
  /** When each one-time hint was shown or dismissed. */
  seen: Partial<Record<SeenFlag, number>>
}

const SEEN_FLAGS: readonly SeenFlag[] = ['giverIntro', 'setupChecklist', 'linkPreviewHint', 'appInstalled']
const ANSWER_KEYS_MAX = 12
const ANSWER_MAX = 300

export function sanitizeRelays(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const relays = value.filter((v): v is string => typeof v === 'string' && isRelayUrl(v))
  return relays.length > 0 ? [...new Set(relays)].slice(0, 20) : undefined
}

/** Collapses whitespace and trims; undefined when empty. Throws nothing: callers check the length. */
export function cleanOwnerName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const n = value.replace(/\s+/g, ' ').trim()
  return n ? n : undefined
}

function sanitizeOwnerName(value: unknown): string | undefined {
  const n = cleanOwnerName(value)
  return n && codePointLength(n) <= LIMITS.ownerName ? n : undefined
}

const isTimestamp = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const isShortId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)

export function sanitizeOnboarding(value: unknown): OnboardingState | undefined {
  if (!isObject(value)) return undefined
  const { status, step, answers, listId, itemId, updatedAt } = value
  if (status !== 'active' && status !== 'completed' && status !== 'dismissed') return undefined
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 0 || step > 19) return undefined
  if (!isTimestamp(updatedAt)) return undefined
  const out: OnboardingState = { status, step, answers: {}, updatedAt }
  if (isObject(answers)) {
    for (const [k, v] of Object.entries(answers).slice(0, ANSWER_KEYS_MAX)) {
      if (/^[a-zA-Z]{1,20}$/.test(k) && typeof v === 'string' && codePointLength(v) <= ANSWER_MAX) out.answers[k] = v
    }
  }
  if (isShortId(listId)) out.listId = listId
  if (isShortId(itemId)) out.itemId = itemId
  return out
}

export async function getSettings(db: HippoDb): Promise<Settings> {
  const rows = await db.settings.bulkGet(['relays', 'theme', 'lastExportAt', 'ownerName', 'onboarding', 'seen'])
  const [relays, theme, lastExportAt, ownerName, onboarding, seen] = rows.map((r) => r?.value)
  const out: Settings = {
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
    seen: {},
  }
  const r = sanitizeRelays(relays)
  if (r) out.relays = r
  if (isTimestamp(lastExportAt)) out.lastExportAt = lastExportAt
  const name = sanitizeOwnerName(ownerName)
  if (name) out.ownerName = name
  const ob = sanitizeOnboarding(onboarding)
  if (ob) out.onboarding = ob
  if (isObject(seen)) {
    for (const flag of SEEN_FLAGS) {
      const at = seen[flag]
      if (isTimestamp(at)) out.seen[flag] = at
    }
  }
  return out
}

export async function setRelayOverride(db: HippoDb, relays: string[] | undefined): Promise<void> {
  const clean = sanitizeRelays(relays)
  if (clean) await db.settings.put({ key: 'relays', value: clean })
  else await db.settings.delete('relays')
}

export async function setTheme(db: HippoDb, theme: Theme): Promise<void> {
  await db.settings.put({ key: 'theme', value: theme })
}

export async function setLastExportAt(db: HippoDb, at: number): Promise<void> {
  await db.settings.put({ key: 'lastExportAt', value: at })
}

/**
 * Sets or clears the owner's display name. Whitespace is collapsed; returns the stored value.
 * Throws a RangeError when the name is longer than `LIMITS.ownerName` code points.
 */
export async function setOwnerName(db: HippoDb, name: string | undefined): Promise<string | undefined> {
  const clean = cleanOwnerName(name)
  if (clean && codePointLength(clean) > LIMITS.ownerName) throw new RangeError(`name is longer than ${LIMITS.ownerName} characters`)
  if (clean) await db.settings.put({ key: 'ownerName', value: clean })
  else await db.settings.delete('ownerName')
  return clean
}

/** Stores first-run setup progress (validated the same way it is read); undefined clears it. */
export async function setOnboarding(db: HippoDb, state: OnboardingState | undefined): Promise<void> {
  const clean = state === undefined ? undefined : sanitizeOnboarding(state)
  if (state !== undefined && !clean) throw new RangeError('invalid onboarding state')
  if (clean) await db.settings.put({ key: 'onboarding', value: clean })
  else await db.settings.delete('onboarding')
}

/** Records that a one-time hint was shown or dismissed on this device. */
export async function markSeen(db: HippoDb, flag: SeenFlag, at: number): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get('seen')
    const prev = isObject(row?.value) ? row.value : {}
    await db.settings.put({ key: 'seen', value: { ...prev, [flag]: at } })
  })
}
