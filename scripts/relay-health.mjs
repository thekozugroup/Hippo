#!/usr/bin/env node
// Relay health check for maintainers (README, "Relay health check").
//
// For each default relay it publishes one small canary event shaped like real
// Hippo traffic, reads it back, and looks for the canaries of 1, 4 and 12
// weeks ago, which an earlier run of this script published. The canary key is
// derived from the ISO week (src/core/services/canary.ts), so every run can
// recompute the keys of past weeks.
//
// Exit code 0 when at least three relays both accept and return today's
// canary, 1 otherwise. The result is a Markdown table on stdout, and is also
// appended to $GITHUB_STEP_SUMMARY when that is set.
//
// Needs Node 22.18 or newer (it imports TypeScript files from src/core, which
// Node runs by removing the types). Honours HTTPS_PROXY / NO_PROXY and trusts
// the CA files Node is already configured with (NODE_EXTRA_CA_CERTS).

import { appendFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { Relay, useWebSocketImplementation as setWebSocketImplementation } from 'nostr-tools/relay'
import WebSocket from 'ws'
import { DEFAULT_RELAYS } from '../src/core/config.ts'
import { buildCanaryEvent, canaryTargets, CANARY_KIND, isoWeek } from '../src/core/services/canary.ts'

const MIN_HEALTHY_RELAYS = 3
const STEP_TIMEOUT_MS = 10_000
const RELAY_DEADLINE_MS = 40_000

// ---- proxy support -------------------------------------------------------

function proxyFor(host) {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy
  if (!raw) return undefined
  const noProxy = (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const h = host.toLowerCase()
  if (noProxy.some((n) => n === '*' || h === n.replace(/^\*?\./, '') || h.endsWith('.' + n.replace(/^\*?\./, '')))) return undefined
  try {
    return new URL(raw)
  } catch {
    return undefined
  }
}

/** HTTPS agent that reaches the relay through an HTTP CONNECT proxy. TLS is verified against Node's normal CA list. */
class ConnectProxyAgent extends https.Agent {
  constructor(proxy) {
    super({ keepAlive: false })
    this.proxy = proxy
  }

  createConnection(options, callback) {
    const port = options.port || 443
    const headers = { host: `${options.host}:${port}` }
    if (this.proxy.username) {
      const cred = `${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`
      headers['proxy-authorization'] = `Basic ${Buffer.from(cred).toString('base64')}`
    }
    const req = http.request({
      host: this.proxy.hostname,
      port: this.proxy.port || 80,
      method: 'CONNECT',
      path: `${options.host}:${port}`,
      headers,
      timeout: STEP_TIMEOUT_MS,
    })
    req.once('timeout', () => req.destroy(new Error('proxy timeout')))
    req.once('error', (err) => callback(err))
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        callback(new Error(`proxy refused CONNECT: ${res.statusCode}`))
        return
      }
      const secure = tls.connect({ socket, servername: options.servername || options.host })
      secure.once('error', (err) => callback(err))
      secure.once('secureConnect', () => callback(null, secure))
    })
    req.end()
  }
}

/**
 * Same approach as src/core/transport/nostr.test.ts: give nostr-tools the `ws`
 * package, because Node's built-in WebSocket re-fires `error` synchronously on
 * refused connections and recurses. This subclass adds the proxy agent.
 */
class RelayWebSocket extends WebSocket {
  constructor(address, protocols) {
    const proxy = proxyFor(new URL(address).hostname)
    super(address, protocols, { handshakeTimeout: STEP_TIMEOUT_MS, ...(proxy ? { agent: new ConnectProxyAgent(proxy) } : {}) })
    // ws throws an unhandled 'error' when nostr-tools closes a socket that is still connecting (its connect timeout).
    // nostr-tools reports the failure itself, so this listener only keeps the process alive.
    this.on('error', () => {})
  }
}
setWebSocketImplementation(RelayWebSocket)

// ---- helpers --------------------------------------------------------------

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function oneLine(e) {
  const s = e instanceof Error ? e.message : String(e)
  return s.replace(/\s+/g, ' ').slice(0, 80)
}

/** Collects events matching `filter` until EOSE, close or timeout. */
function query(relay, filter) {
  return new Promise((resolve) => {
    const events = []
    let sub
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      try {
        sub?.close()
      } catch {
        // already closed
      }
      resolve(events)
    }
    const timer = setTimeout(done, STEP_TIMEOUT_MS)
    try {
      sub = relay.subscribe([filter], { onevent: (e) => events.push(e), oneose: done, onclose: done })
    } catch {
      done()
    }
  })
}

async function checkRelay(url, today, olderTargets, allTargets) {
  const r = { url, reachable: false, accepted: false, readBack: false, older: {}, note: '' }
  for (const t of olderTargets) r.older[t.weeksAgo] = false
  let relay
  try {
    relay = new Relay(url)
    await withTimeout(relay.connect({ timeout: STEP_TIMEOUT_MS }), STEP_TIMEOUT_MS + 1000, 'connect timeout')
    r.reachable = true

    try {
      await withTimeout(relay.publish(today.event), STEP_TIMEOUT_MS, 'publish timeout')
      r.accepted = true
    } catch (e) {
      r.note = `publish: ${oneLine(e)}`
    }

    const events = await query(relay, {
      kinds: [CANARY_KIND],
      authors: allTargets.map((t) => t.pubkey),
      '#t': allTargets.map((t) => t.topic),
      limit: 50,
    })
    const has = (target) =>
      events.some((e) => e.pubkey === target.pubkey && e.tags.some((t) => t[0] === 'd' && t[1] === target.slot) && e.tags.some((t) => t[0] === 't' && t[1] === target.topic))
    r.readBack = events.some((e) => e.id === today.event.id)
    for (const t of olderTargets) r.older[t.weeksAgo] = has(t)
  } catch (e) {
    r.note ||= oneLine(e)
  } finally {
    try {
      relay?.close()
    } catch {
      // already closed
    }
  }
  return r
}

// ---- main -----------------------------------------------------------------

const now = new Date()
const week = isoWeek(now)
const event = buildCanaryEvent(week, Math.floor(now.getTime() / 1000))
const todayTarget = canaryTargets(now, [0])[0]
const older = canaryTargets(now) // 1, 4 and 12 weeks ago
const allTargets = [todayTarget, ...older]
const today = { event }

const results = await Promise.all(
  DEFAULT_RELAYS.map((url) =>
    withTimeout(checkRelay(url, today, older, allTargets), RELAY_DEADLINE_MS, 'deadline').catch((e) => ({
      url,
      reachable: false,
      accepted: false,
      readBack: false,
      older: Object.fromEntries(older.map((t) => [t.weeksAgo, false])),
      note: oneLine(e),
    })),
  ),
)

const yn = (b) => (b ? 'yes' : 'no')
const lines = [
  `### Relay health, ${now.toISOString().slice(0, 10)} (${week})`,
  '',
  '| Relay | Reachable | Accepted today | Read back | 1 week ago | 4 weeks ago | 12 weeks ago | Note |',
  '|---|---|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.url} | ${yn(r.reachable)} | ${yn(r.accepted)} | ${yn(r.readBack)} | ${yn(r.older[1])} | ${yn(r.older[4])} | ${yn(r.older[12])} | ${r.note.replaceAll('|', '/')} |`),
]
const healthy = results.filter((r) => r.accepted && r.readBack).length
const ok = healthy >= MIN_HEALTHY_RELAYS
lines.push(
  '',
  `${healthy} of ${results.length} relays accepted and returned today's canary (at least ${MIN_HEALTHY_RELAYS} needed): **${ok ? 'PASS' : 'FAIL'}**.`,
  '',
  'Older columns show "no" on the first runs, before those canaries were published. A relay that says "no" for 4 or 12 weeks after the script has run that long is dropping events early.',
)
const text = lines.join('\n') + '\n'
process.stdout.write(text)
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
  } catch (e) {
    console.error(`could not write job summary: ${oneLine(e)}`)
  }
}
// Open sockets must not keep the process alive.
process.exit(ok ? 0 : 1)
