// `d` slot naming, PROTOCOL.md section 4.

export const HIPPO_KIND = 30078

export type Slot =
  | { type: 'meta' }
  | { type: 'item'; itemId: string }
  | { type: 'claim'; claimId: string }

export function metaSlot(topic: string): string {
  return `hippo:${topic}:meta`
}

export function itemSlot(topic: string, itemId: string): string {
  return `hippo:${topic}:item:${itemId}`
}

export function claimSlot(topic: string, claimId: string): string {
  return `hippo:${topic}:claim:${claimId}`
}

const ID = '[0-9a-f]{32}'
const ITEM_RE = new RegExp(`^item:(${ID})$`)
const CLAIM_RE = new RegExp(`^claim:(${ID})$`)

/** Parses a slot for the given topic; `null` when the prefix or shape is wrong. */
export function parseSlot(d: string, topic: string): Slot | null {
  const prefix = `hippo:${topic}:`
  if (!d.startsWith(prefix)) return null
  const rest = d.slice(prefix.length)
  if (rest === 'meta') return { type: 'meta' }
  const item = ITEM_RE.exec(rest)
  if (item?.[1]) return { type: 'item', itemId: item[1] }
  const claim = CLAIM_RE.exec(rest)
  if (claim?.[1]) return { type: 'claim', claimId: claim[1] }
  return null
}
