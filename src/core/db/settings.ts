// Typed key/value settings. Stored values are re-validated on read because
// IndexedDB contents can be stale from an older version or edited by hand.

import { isRelayUrl } from '../model/validate.ts'
import type { HippoDb } from './schema.ts'

export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  /** Overrides the default relays for new shared lists and v1 links; undefined = defaults. */
  relays?: string[]
  theme: Theme
  lastExportAt?: number
}

export function sanitizeRelays(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const relays = value.filter((v): v is string => typeof v === 'string' && isRelayUrl(v))
  return relays.length > 0 ? [...new Set(relays)].slice(0, 20) : undefined
}

export async function getSettings(db: HippoDb): Promise<Settings> {
  const rows = await db.settings.bulkGet(['relays', 'theme', 'lastExportAt'])
  const [relays, theme, lastExportAt] = rows.map((r) => r?.value)
  const out: Settings = {
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
  }
  const r = sanitizeRelays(relays)
  if (r) out.relays = r
  if (typeof lastExportAt === 'number' && Number.isSafeInteger(lastExportAt)) out.lastExportAt = lastExportAt
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
