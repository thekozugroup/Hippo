// The only way owner code talks to a transport. Every read is restricted to
// the owner's own pubkey, so the owner app never downloads claims (PRD
// FR-17, PROTOCOL.md section 7). Results are filtered again locally in case
// a relay ignores the `authors` restriction.

import type { Filter } from 'nostr-tools/filter'
import { HIPPO_KIND } from '../protocol/slots.ts'
import type { NostrEvent, PublishResult, Transport } from '../transport/types.ts'

export class OwnerChannel {
  readonly topic: string
  readonly ownerPubkey: string
  private readonly transport: Transport

  constructor(transport: Transport, topic: string, ownerPubkey: string) {
    this.transport = transport
    this.topic = topic
    this.ownerPubkey = ownerPubkey
  }

  /** `{ kinds:[30078], authors:[ownerPubkey], '#t':[topic] }` and nothing broader. */
  get filter(): Filter {
    return { kinds: [HIPPO_KIND], authors: [this.ownerPubkey], '#t': [this.topic] }
  }

  async fetchOwnEvents(timeoutMs?: number): Promise<NostrEvent[]> {
    const events = await this.transport.fetch(this.filter, timeoutMs === undefined ? undefined : { timeoutMs })
    return events.filter((e) => e.pubkey === this.ownerPubkey)
  }

  publish(event: NostrEvent): Promise<PublishResult> {
    return this.transport.publish(event)
  }
}
