// What this device remembers about the account, in the settings table. The secret lives here and
// nowhere else: never in a backup file, a log, the title or the address bar. Values are checked
// again on read, like every other setting.

import { randomId } from '../crypto/bytes.ts'
import type { HippoDb } from '../db/schema.ts'
import { isHex, isObject } from '../model/guards.ts'
import { isAccountSecret } from './keys.ts'

export const ACCOUNT_SETTING_KEY = 'account'
export const DEVICE_ID_SETTING_KEY = 'deviceId'
/** When the person confirmed they saved the recovery code (synced in the profile record). */
export const RECOVERY_SAVED_SETTING_KEY = 'recoverySavedAt'

export interface AccountState {
  /** 16 bytes hex: the recovery code's secret. */
  secret: string
  createdAt: number
  /** Sync on this device. On by default; the person can turn it off per device. */
  sync: boolean
  /** Signed in (or created) but not yet merged with what the sync servers hold. Nothing is sent until that merge. */
  needsMerge?: boolean
  /** Newest `created_at` (unix seconds) received; the next fetch asks only for what came after it. */
  cursor?: number
  /** Last time every change was on the sync servers and the fetch was answered (ms). */
  lastSyncAt?: number
  /** Last full fetch (ms); one runs at sign-in and then once a day. */
  lastFullAt?: number
  /** The recovery code was changed on another device (ms): this device stopped and asks to sign in again. */
  replacedAt?: number
  /** After a recovery code change on this device: the old secret, kept only until its records are emptied on the sync servers. */
  retiring?: string
}

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

export function sanitizeAccountState(value: unknown): AccountState | undefined {
  if (!isObject(value) || !isAccountSecret(value.secret) || !isTime(value.createdAt)) return undefined
  const out: AccountState = { secret: value.secret, createdAt: value.createdAt, sync: value.sync !== false }
  if (value.needsMerge === true) out.needsMerge = true
  for (const k of ['cursor', 'lastSyncAt', 'lastFullAt', 'replacedAt'] as const) {
    const v = value[k]
    if (isTime(v)) out[k] = v
  }
  if (isAccountSecret(value.retiring) && value.retiring !== value.secret) out.retiring = value.retiring
  return out
}

export async function getAccountState(db: HippoDb): Promise<AccountState | undefined> {
  return sanitizeAccountState((await db.settings.get(ACCOUNT_SETTING_KEY))?.value)
}

export async function putAccountState(db: HippoDb, state: AccountState): Promise<void> {
  await db.settings.put({ key: ACCOUNT_SETTING_KEY, value: { ...state } })
}

/** Changes the stored state only if it still belongs to the same secret (a sign-out or code change in between wins). */
export async function updateAccountState(db: HippoDb, secret: string, patch: Partial<AccountState>, drop: readonly (keyof AccountState)[] = []): Promise<AccountState | undefined> {
  return db.transaction('rw', db.settings, async () => {
    const cur = await getAccountState(db)
    if (!cur || cur.secret !== secret) return undefined
    if (Object.keys(patch).length === 0 && !drop.some((k) => k in cur)) return cur
    const next: AccountState = { ...cur, ...patch }
    for (const k of drop) delete next[k]
    await putAccountState(db, next)
    return next
  })
}

/** A random id for this device, made once; it breaks ties between two writes in the same millisecond. Never synced. */
export async function getDeviceId(db: HippoDb): Promise<string> {
  return db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get(DEVICE_ID_SETTING_KEY)
    if (isHex(row?.value, 16)) return row.value
    const id = randomId()
    await db.settings.put({ key: DEVICE_ID_SETTING_KEY, value: id })
    return id
  })
}

export async function getRecoverySavedAt(db: HippoDb): Promise<number | undefined> {
  const v = (await db.settings.get(RECOVERY_SAVED_SETTING_KEY))?.value
  return isTime(v) ? v : undefined
}
