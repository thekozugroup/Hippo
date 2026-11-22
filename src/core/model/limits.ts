// String limits come from PROTOCOL.md section 5. The numeric caps are ours:
// they keep hostile payloads from forcing huge allocations or loops.

export const LIMITS = {
  title: 200,
  notes: 2000,
  url: 2000,
  nickname: 40,
  /** The list owner's display name in list meta. */
  ownerName: 40,
  name: 100,
  message: 1000,
  categoryName: 60,
  emoji: 16,
  /** Items per shared list. */
  itemIds: 1000,
  /** Quantity wanted per item. */
  quantity: 9999,
  /**
   * Largest money amount in minor units (10^11). Chosen so that
   * amount * quantity and sums of many pledges stay exact in a double.
   */
  amount: 100_000_000_000,
  /** Encrypted event content, base64 characters. */
  content: 65_536,
  relays: 20,
  relayUrl: 200,
  /** Distinct claim slots kept per list; further new slots are ignored. */
  claimsPerList: 5000,
  /** Remembered titles of items I claimed, per list shared with me. */
  claimTitles: 1000,
  /** Events kept from one fetch or one initial subscription burst. */
  eventsPerFetch: 10_000,
  /** How far in the future a claim may be dated (clock skew allowance), ms. */
  futureSkewMs: 10 * 60 * 1000,
} as const
