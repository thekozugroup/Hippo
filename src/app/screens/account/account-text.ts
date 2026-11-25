// What the account screens say. Plain words: no "relay", "event" or "key". Pure, for tests.

import type { AccountSummary } from '../../../core/account/service.ts'
import type { RecoveryCodeResult } from '../../../core/account/recovery-code.ts'
import { plural } from '../../lib/format.ts'

export type StatusTone = 'ok' | 'busy' | 'warn' | 'off'

export interface StatusLine {
  tone: StatusTone
  text: string
}

function timeOf(ms: number, now: number, locale?: string): string {
  const d = new Date(ms)
  const sameDay = new Date(now).toDateString() === d.toDateString()
  return sameDay ? d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

/** One line for Settings: is everything on the other devices, and since when. */
export function statusLine(s: AccountSummary, live: { offline: boolean; syncing: boolean }, now: number = Date.now(), locale?: string): StatusLine {
  if (s.phase === 'replaced') return { tone: 'warn', text: 'Your recovery code was changed on another device. Sign in again with the new code to keep this device in step.' }
  if (s.phase === 'off') return { tone: 'off', text: 'Sync is off on this device. Changes here stay here.' }
  if (s.waitingForFirstSync) return { tone: 'busy', text: live.offline ? 'Waiting for a connection to bring your wishes here.' : 'Bringing your wishes here…' }
  if (live.offline) return { tone: 'warn', text: s.unsent > 0 ? `Waiting for a connection. ${plural(s.unsent, 'change', 'changes')} will be sent then.` : 'Waiting for a connection.' }
  if (s.unsent > 0) return { tone: 'busy', text: `Sending ${plural(s.unsent, 'change', 'changes')}…` }
  if (live.syncing && s.lastSyncAt === undefined) return { tone: 'busy', text: 'Checking for changes…' }
  if (s.lastSyncAt !== undefined) return { tone: 'ok', text: `Up to date. Last synced ${timeOf(s.lastSyncAt, now, locale)}.` }
  return { tone: 'busy', text: 'Checking for changes…' }
}

/** Why a typed recovery code was not accepted, and what to do. */
export function codeProblemText(r: Extract<RecoveryCodeResult, { ok: false }>): string {
  switch (r.reason) {
    case 'count':
      return r.count === 0 ? 'Enter your 13-word recovery code.' : `A recovery code has 13 words. This has ${r.count}.`
    case 'word':
      return `Word ${r.position}, “${r.word.slice(0, 20)}”, is not in a recovery code. Check its spelling.`
    case 'checksum':
      return 'These words do not add up to a recovery code. One of them may be wrong, or two may be swapped.'
  }
}

/** The text file "Save as a file" writes. */
export function recoveryFileText(words: readonly string[], site: string): string {
  return [
    'Hippo recovery code',
    '',
    words.map((w, i) => `${String(i + 1).padStart(2, ' ')}. ${w}`).join('\n'),
    '',
    'Use it to open your wishlist and lists on another phone or browser: Hippo, I already use Hippo, Sign in with my recovery code.',
    'Anyone with this code can read and change your wishlist. Hippo cannot recover it or reset it for you.',
    site ? `Your Hippo site: ${site}` : '',
  ]
    .join('\n')
    .trimEnd()
    .concat('\n')
}

export const RECOVERY_FILE_NAME = 'hippo-recovery-code.txt'
