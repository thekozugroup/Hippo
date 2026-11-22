// A minimal in-process NIP-01 relay for integration and end-to-end tests.
// Node only. Supports EVENT/REQ/CLOSE with OK/EOSE/CLOSED/NOTICE replies,
// signature checks, replaceable and addressable replacement, NIP-40
// expiration and the filter fields kinds, authors, ids, #<tag>, since,
// until and limit.
//
// Run standalone (e.g. from Playwright's webServer):
//   node src/core/testing/mock-relay.ts            # port from MOCK_RELAY_PORT or 7447
// It prints `mock relay listening on ws://127.0.0.1:<port>` once ready.

import { WebSocketServer, type WebSocket } from 'ws'
import { matchFilter } from 'nostr-tools/filter'
import { verifyEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'
import type { NostrEvent } from 'nostr-tools/core'
import { RelayStore } from '../transport/relay-store.ts'

export interface MockRelay {
  url: string
  port: number
  /** Events currently stored (after replacement). */
  readonly events: NostrEvent[]
  /** Every REQ filter received, for asserting access patterns. */
  readonly filters: Filter[]
  clear(): void
  /** Simulates an outage: drops every connection and refuses new ones until `resume()`. Stored events are kept. */
  pause(): void
  resume(): void
  close(): Promise<void>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toEvent(v: unknown): NostrEvent | null {
  if (!isRecord(v)) return null
  const { id, pubkey, sig, kind, created_at, content, tags } = v
  if (typeof id !== 'string' || typeof pubkey !== 'string' || typeof sig !== 'string') return null
  if (typeof kind !== 'number' || typeof created_at !== 'number' || typeof content !== 'string') return null
  if (!Array.isArray(tags) || !tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'))) return null
  return { id, pubkey, sig, kind, created_at, content, tags: tags as string[][] }
}

function toFilter(v: unknown): Filter | null {
  return isRecord(v) ? (v as Filter) : null
}

export function startMockRelay(port = 0): Promise<MockRelay> {
  const store = new RelayStore()
  const filters: Filter[] = []
  const subs = new Map<WebSocket, Map<string, Filter[]>>()
  const wss = new WebSocketServer({ port, host: '127.0.0.1' })

  const send = (ws: WebSocket, msg: unknown[]): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
  }

  let paused = false
  wss.on('connection', (ws) => {
    if (paused) {
      ws.terminate()
      return
    }
    subs.set(ws, new Map())
    ws.on('close', () => subs.delete(ws))
    ws.on('message', (data) => {
      let msg: unknown
      try {
        msg = JSON.parse(String(data))
      } catch {
        send(ws, ['NOTICE', 'error: invalid JSON'])
        return
      }
      if (!Array.isArray(msg) || typeof msg[0] !== 'string') {
        send(ws, ['NOTICE', 'error: invalid message'])
        return
      }
      const [type, ...rest] = msg as [string, ...unknown[]]
      if (type === 'EVENT') {
        const event = toEvent(rest[0])
        if (!event) {
          send(ws, ['NOTICE', 'error: invalid event'])
          return
        }
        if (!verifyEvent({ ...event })) {
          send(ws, ['OK', event.id, false, 'invalid: bad signature'])
          return
        }
        const outcome = store.add(event)
        if (outcome === 'expired') {
          send(ws, ['OK', event.id, false, 'invalid: event is expired'])
          return
        }
        if (outcome === 'duplicate' || outcome === 'replaced-newer-exists') {
          send(ws, ['OK', event.id, true, 'duplicate: have this event or a newer one'])
          return
        }
        send(ws, ['OK', event.id, true, ''])
        for (const [client, clientSubs] of subs) {
          for (const [subId, fs] of clientSubs) {
            if (fs.some((f) => matchFilter(f, event))) send(client, ['EVENT', subId, event])
          }
        }
        return
      }
      if (type === 'REQ') {
        const subId = rest[0]
        if (typeof subId !== 'string') {
          send(ws, ['NOTICE', 'error: invalid subscription id'])
          return
        }
        const fs = rest.slice(1).map(toFilter)
        if (fs.length === 0 || fs.some((f) => f === null)) {
          send(ws, ['CLOSED', subId, 'error: invalid filter'])
          return
        }
        const valid = fs as Filter[]
        filters.push(...valid.map((f) => structuredClone(f)))
        subs.get(ws)?.set(subId, valid)
        const seen = new Set<string>()
        for (const f of valid) {
          for (const e of store.query(f)) {
            if (seen.has(e.id)) continue
            seen.add(e.id)
            send(ws, ['EVENT', subId, e])
          }
        }
        send(ws, ['EOSE', subId])
        return
      }
      if (type === 'CLOSE') {
        if (typeof rest[0] === 'string') subs.get(ws)?.delete(rest[0])
        return
      }
      send(ws, ['NOTICE', `error: unsupported message ${type}`])
    })
  })

  return new Promise((resolve, reject) => {
    wss.once('error', reject)
    wss.once('listening', () => {
      const address = wss.address()
      const actualPort = typeof address === 'object' && address !== null ? address.port : port
      resolve({
        url: `ws://127.0.0.1:${actualPort}`,
        port: actualPort,
        get events() {
          return store.all()
        },
        filters,
        clear: () => store.clear(),
        pause: () => {
          paused = true
          for (const client of wss.clients) client.terminate()
        },
        resume: () => {
          paused = false
        },
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate()
            wss.close(() => done())
          }),
      })
    })
  })
}

// Standalone entry point. `process` is checked first so importing this file
// in a browser-like test environment does nothing.
const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href

if (isMain) {
  const port = Number(process.env.MOCK_RELAY_PORT ?? 7447)
  void startMockRelay(port).then((relay) => {
    console.log(`mock relay listening on ${relay.url}`)
    const stop = (): void => {
      void relay.close().then(() => process.exit(0))
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
}
