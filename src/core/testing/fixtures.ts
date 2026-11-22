// Test helpers: an isolated database and a controllable clock per "device".

import { openDb } from '../db/schema.ts'
import { randomId } from '../crypto/bytes.ts'
import type { CoreDeps } from '../services/deps.ts'
import { MemoryNetwork, MemoryTransport } from '../transport/memory.ts'
import type { TransportProvider } from '../transport/types.ts'

export interface TestClock {
  now: () => number
  advance(ms: number): void
}

export function testClock(start = Date.UTC(2026, 10, 1)): TestClock {
  let t = start
  return { now: () => t, advance: (ms) => (t += ms) }
}

export interface TestDevice extends CoreDeps {
  transport: MemoryTransport
  clock: TestClock
}

/** A device with its own database, attached to a shared in-memory network. */
export function testDevice(network: MemoryNetwork, clock: TestClock = testClock(), name = 'device'): TestDevice {
  const transport = new MemoryTransport({ network, name })
  const transports: TransportProvider = () => transport
  return { db: openDb(`hippo-test-${name}-${randomId()}`), transports, now: clock.now, transport, clock }
}

/** Resolves after pending microtasks and a macrotask, so queued deliveries settle. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Polls until `check` returns true or the timeout passes. */
export async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}
