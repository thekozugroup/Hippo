// What the transfer screens say: one plain sentence per outcome. Pure, for tests.

import { isTransferError, type TransferFailure } from '../../../core/index.ts'

/** Minutes left, rounded up ("Works for 14 more minutes"). */
export function timeLeftText(ms: number): string {
  if (ms <= 60_000) return 'Works for less than a minute more.'
  const min = Math.ceil(ms / 60_000)
  return `Works for ${min} more minutes.`
}

export function transferStartError(e: unknown): string {
  if (isTransferError(e, 'too-large')) return 'Your wishlist is too large to send this way. Use Export backup in Settings and move the file instead.'
  if (isTransferError(e, 'offline')) return 'Hippo could not reach its sync servers. Check your connection and try again.'
  return 'The link could not be made. Please try again.'
}

const MESSAGES: Record<TransferFailure, string> = {
  'invalid-link': 'This is not a Hippo transfer link. Copy the whole link from the other device.',
  'unsupported-version': 'This link comes from a newer version of Hippo. Update Hippo on this device, then try again.',
  expired: 'This link has expired. Make a new one on the other device.',
  'not-found': 'Nothing was found for this link. It may have expired or been cancelled. Make a new one on the other device.',
  offline: 'Hippo could not reach its sync servers. Check your connection and try again.',
  cancelled: 'This transfer was cancelled on the other device.',
  used: 'This link was already used to move Hippo to a device. Make a new one if you need it again.',
  missing: 'Part of the transfer is missing from the sync servers, so nothing was brought in. Make a new link on the other device.',
  tampered: 'Part of the transfer did not match what was sent, so nothing was brought in. Make a new link on the other device.',
  'too-large': 'This transfer is too large to receive. Move a backup file instead.',
  'invalid-backup': 'What arrived is not a valid Hippo backup, so nothing was brought in.',
  unsupported: 'This browser cannot open this transfer. Try another browser, or move a backup file instead.',
}

export function transferErrorText(e: unknown): string {
  return isTransferError(e) ? MESSAGES[e.reason] : 'Something went wrong, and nothing was brought in. Please try again.'
}

