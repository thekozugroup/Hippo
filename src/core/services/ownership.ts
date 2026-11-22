// FR-25: a device never opens, as a giver, a list it owns, used to own
// (rotation) or deleted. Checked by topic and by owner key, so neither a new
// link to an old topic nor an old owner key slips through.

import { publicKeyOf, topicForSecret } from '../crypto/keys.ts'
import type { HippoDb } from '../db/schema.ts'

export interface ListIdentity {
  topic: string
  ownerPubkey: string
}

/** True when this device owns, has retired or has deleted a list with that topic or owner key. */
export async function isOwnListIdentity(db: HippoDb, id: Partial<ListIdentity>): Promise<boolean> {
  if (id.topic !== undefined && (await db.retiredLists.get(id.topic))) return true
  if (id.ownerPubkey !== undefined && (await db.retiredLists.where('ownerPubkey').equals(id.ownerPubkey).count()) > 0) return true
  const lists = await db.sharedLists.toArray()
  return lists.some(
    (l) =>
      (id.topic !== undefined && topicForSecret(l.listSecret) === id.topic) ||
      (id.ownerPubkey !== undefined && publicKeyOf(l.ownerSecretKey) === id.ownerPubkey),
  )
}
