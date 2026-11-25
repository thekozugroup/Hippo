// Turning the account on and off on this device, PROTOCOL.md section 12.5 to 12.8. No server and
// no password: the account is the secret, and these functions only change what this device holds.

import type { HippoDb } from '../db/schema.ts'
import { LINK_PREVIEW_SETTING_KEY } from '../services/link-preview.ts'
import type { CoreDeps } from '../services/deps.ts'
import { getSettings } from '../db/settings.ts'
import { generateAccountSecret, deriveAccountKeys, isAccountSecret } from './keys.ts'
import { accountSlot, nextStamp, PROFILE_ID, type RecordType } from './records.ts'
import {
  ACCOUNT_SETTING_KEY,
  getAccountState,
  getDeviceId,
  getRecoverySavedAt,
  putAccountState,
  RECOVERY_SAVED_SETTING_KEY,
  type AccountState,
} from './state.ts'

export type AccountErrorReason =
  /** This device is signed in to a different account: sign out here first. */
  | 'other-account'
  /** No account on this device. */
  | 'no-account'
  /** The recovery code was changed on another device: sign in with the new one first. */
  | 'replaced'
  | 'invalid-secret'

export class AccountError extends Error {
  readonly reason: AccountErrorReason
  constructor(reason: AccountErrorReason) {
    super(reason)
    this.name = 'AccountError'
    this.reason = reason
  }
}

export function isAccountError(e: unknown, reason?: AccountErrorReason): e is AccountError {
  return e instanceof AccountError && (reason === undefined || e.reason === reason)
}

async function finishSetup(db: HippoDb, now: number): Promise<void> {
  const ob = (await getSettings(db)).onboarding
  if (!ob || ob.status === 'active') await db.settings.put({ key: 'onboarding', value: { status: 'completed', step: 0, answers: {}, updatedAt: now } })
}

/**
 * The account for this device, made the first time it is needed (showing the recovery code, adding
 * a device, moving to a new address). Sync is on. Nothing is sent before the first fetch has
 * checked what the sync servers hold. Returns the secret.
 */
export async function ensureAccount(deps: Pick<CoreDeps, 'db' | 'now'>): Promise<string> {
  await getDeviceId(deps.db)
  return deps.db.transaction('rw', deps.db.settings, deps.db.accountRecords, async () => {
    const cur = await getAccountState(deps.db)
    if (cur && cur.replacedAt === undefined) return cur.secret
    // Never start a second, separate account on a device whose code was changed elsewhere.
    if (cur) throw new AccountError('replaced')
    const secret = generateAccountSecret()
    await deps.db.accountRecords.clear()
    await putAccountState(deps.db, { secret, createdAt: deps.now(), sync: true, needsMerge: true })
    return secret
  })
}

export interface SignInOptions {
  /** Signed in by typing the code: the person evidently has it written down. */
  codeSaved?: boolean
}

/**
 * Signs this device in to an account (recovery code or device link). Data already on the device is
 * kept and merged on the first sync, never replaced. Setup is marked done. Throws `other-account`
 * when the device is signed in to a different account (unless that one was replaced by a new code).
 */
export async function signInToAccount(deps: Pick<CoreDeps, 'db' | 'now'>, secret: string, options: SignInOptions = {}): Promise<'signed-in' | 'already'> {
  if (!isAccountSecret(secret)) throw new AccountError('invalid-secret')
  await getDeviceId(deps.db)
  return deps.db.transaction('rw', deps.db.settings, deps.db.accountRecords, async () => {
    const now = deps.now()
    const cur = await getAccountState(deps.db)
    if (options.codeSaved && !(await getRecoverySavedAt(deps.db))) await deps.db.settings.put({ key: RECOVERY_SAVED_SETTING_KEY, value: now })
    await finishSetup(deps.db, now)
    if (cur && cur.secret === secret && cur.replacedAt === undefined) {
      if (!cur.sync) await putAccountState(deps.db, { ...cur, sync: true })
      return 'already'
    }
    if (cur && cur.replacedAt === undefined) throw new AccountError('other-account')
    await deps.db.accountRecords.clear()
    await putAccountState(deps.db, { secret, createdAt: now, sync: true, needsMerge: true })
    return 'signed-in'
  })
}

/** Turns sync on or off for this device only. */
export async function setAccountSync(db: HippoDb, on: boolean): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const cur = await getAccountState(db)
    if (!cur) throw new AccountError('no-account')
    await putAccountState(db, { ...cur, sync: on })
  })
}

/** The person confirmed they saved the recovery code. Syncs, so other devices stop asking too. */
export async function markRecoveryCodeSaved(deps: Pick<CoreDeps, 'db' | 'now'>): Promise<void> {
  await deps.db.settings.put({ key: RECOVERY_SAVED_SETTING_KEY, value: deps.now() })
}

/** This device's account state, if any. */
export const accountState = getAccountState

/** The secret, for showing the recovery code or making a device link. */
export async function accountSecret(db: HippoDb): Promise<string | undefined> {
  const st = await getAccountState(db)
  return st && st.replacedAt === undefined ? st.secret : undefined
}

/**
 * Signs this device out. With `removeData`, this device's wishes, lists and their keys are removed
 * too (other devices keep theirs); without it, everything stays here and simply stops syncing.
 * Theme and other device-only settings stay either way.
 */
export async function signOutOfAccount(db: HippoDb, options: { removeData: boolean }): Promise<void> {
  await db.transaction('rw', [db.settings, db.accountRecords, db.items, db.categories, db.sharedLists, db.guestLists, db.retiredLists, db.events], async () => {
    await db.settings.delete(ACCOUNT_SETTING_KEY)
    await db.accountRecords.clear()
    if (!options.removeData) return
    await Promise.all([db.items.clear(), db.categories.clear(), db.sharedLists.clear(), db.guestLists.clear(), db.retiredLists.clear(), db.events.clear()])
    await db.settings.bulkDelete(['ownerName', 'relays', 'onboarding', 'lastExportAt', LINK_PREVIEW_SETTING_KEY, RECOVERY_SAVED_SETTING_KEY])
  })
}

/**
 * A new recovery code, for when the old one may have leaked. Every record is kept and sent again
 * under the new secret; the old account then gets a signed "retired" marker, which makes devices
 * still using the old code stop and ask to sign in again, and its records are emptied on the sync
 * servers (`finishRetiring`, retried by sync until it lands). Returns the new secret.
 */
export async function changeRecoveryCode(deps: Pick<CoreDeps, 'db' | 'now'>): Promise<string> {
  const device = await getDeviceId(deps.db)
  return deps.db.transaction('rw', deps.db.settings, deps.db.accountRecords, async () => {
    const cur = await getAccountState(deps.db)
    if (!cur || cur.replacedAt !== undefined) throw new AccountError('no-account')
    const secret = generateAccountSecret()
    const keys = deriveAccountKeys(secret)
    const rows = await deps.db.accountRecords.toArray()
    await deps.db.accountRecords.clear()
    await deps.db.accountRecords.bulkPut(
      rows.map(({ createdAt: _c, expiresAt: _e, ...r }) => {
        const next = { ...r, d: accountSlot(keys, r.type as RecordType, r.id), pending: true }
        // The new code has not been saved yet.
        if (r.type === 'profile' && r.id === PROFILE_ID && 'recoverySavedAt' in r.data) {
          const { recoverySavedAt: _s, ...data } = r.data
          next.data = data
          next.f = { ...r.f, recoverySavedAt: nextStamp({ data: r.data, f: r.f }, deps.now(), device) }
        }
        return next
      }),
    )
    await deps.db.settings.delete(RECOVERY_SAVED_SETTING_KEY)
    const next: AccountState = { secret, createdAt: deps.now(), sync: true, retiring: cur.secret }
    if (cur.needsMerge) next.needsMerge = true
    await putAccountState(deps.db, next)
    return secret
  })
}

export type AccountPhase = 'none' | 'on' | 'off' | 'replaced'

export interface AccountSummary {
  phase: AccountPhase
  lastSyncAt?: number
  /** Changes on this device that are not on the sync servers yet. */
  unsent: number
  recoverySavedAt?: number
  /** Signed in, waiting to read what the account holds before sending anything. */
  waitingForFirstSync: boolean
}

/** What Settings and Home show. Reads only this device's database. */
export async function accountSummary(db: HippoDb): Promise<AccountSummary> {
  const st = await getAccountState(db)
  const recoverySavedAt = await getRecoverySavedAt(db)
  if (!st) return { phase: 'none', unsent: 0, waitingForFirstSync: false, ...(recoverySavedAt !== undefined ? { recoverySavedAt } : {}) }
  const unsent = await db.accountRecords.filter((r) => r.pending === true && !r.refused).count()
  return {
    phase: st.replacedAt !== undefined ? 'replaced' : st.sync ? 'on' : 'off',
    unsent,
    waitingForFirstSync: st.needsMerge === true,
    ...(st.lastSyncAt !== undefined ? { lastSyncAt: st.lastSyncAt } : {}),
    ...(recoverySavedAt !== undefined ? { recoverySavedAt } : {}),
  }
}
