import { describe, expect, it } from 'vitest'
import { checkDeployment, type DeploymentCheck, type DeploymentEnv, type ProbeSocket } from './deployment.ts'

type Behaviour = 'open' | 'error' | 'close' | 'hang' | 'throw'

function socketFactory(behaviours: Record<string, Behaviour>, opened: string[] = [], closed: string[] = []): (url: string) => ProbeSocket {
  return (url) => {
    const b = behaviours[url] ?? 'hang'
    if (b === 'throw') throw new Error('SecurityError')
    const s: ProbeSocket = {
      onopen: null,
      onerror: null,
      onclose: null,
      close() {
        closed.push(url)
      },
    }
    opened.push(url)
    queueMicrotask(() => {
      if (b === 'open') s.onopen?.({})
      else if (b === 'error') s.onerror?.({})
      else if (b === 'close') s.onclose?.({})
    })
    return s
  }
}

function good(over: Partial<DeploymentEnv> = {}): DeploymentEnv {
  return {
    location: { protocol: 'https:', hostname: 'hippo.example.org', pathname: '/' },
    framed: false,
    navigator: { onLine: true, serviceWorker: { controller: {} }, storage: { persisted: () => Promise.resolve(true) } },
    probeIndexedDb: () => Promise.resolve(true),
    createWebSocket: socketFactory({ 'wss://a.example': 'open', 'wss://b.example': 'open' }),
    relays: ['wss://a.example', 'wss://b.example'],
    relayTimeoutMs: 100,
    ...over,
  }
}

async function check(env: DeploymentEnv, id: DeploymentCheck['id']): Promise<DeploymentCheck> {
  const all = await checkDeployment(env)
  const c = all.find((x) => x.id === id)
  if (!c) throw new Error('missing check ' + id)
  return c
}

describe('checkDeployment', () => {
  it('returns every check in a fixed order, all ok for a good environment', async () => {
    const all = await checkDeployment(good())
    expect(all.map((c) => c.id)).toEqual(['https', 'own-origin', 'not-framed', 'service-worker', 'indexeddb', 'persistent-storage', 'relays'])
    expect(all.map((c) => c.status)).toEqual(Array(7).fill('ok'))
    for (const c of all) {
      expect(c.finding.length).toBeGreaterThan(0)
      if (c.status === 'ok') expect(c.fix).toBe('')
    }
  })

  it('leaves out skipped checks without running them (the Android app skips the browser-only ones)', async () => {
    const all = await checkDeployment(
      good({
        location: { protocol: 'https:', hostname: 'localhost', pathname: '/' },
        navigator: { onLine: true, serviceWorker: { controller: null }, storage: { persisted: () => Promise.resolve(false) } },
        skip: ['own-origin', 'service-worker', 'persistent-storage'],
      }),
    )
    expect(all.map((c) => c.id)).toEqual(['https', 'not-framed', 'indexeddb', 'relays'])
    expect(all.every((c) => c.status === 'ok')).toBe(true)
  })

  describe('https', () => {
    it('ok on https', async () => expect((await check(good(), 'https')).status).toBe('ok'))
    it.each(['localhost', '127.0.0.1', '[::1]', 'app.localhost'])('ok on http %s', async (hostname) => {
      expect((await check(good({ location: { protocol: 'http:', hostname, pathname: '/' } }), 'https')).status).toBe('ok')
    })
    it('problem on plain http elsewhere', async () => {
      const c = await check(good({ location: { protocol: 'http:', hostname: 'hippo.example.org', pathname: '/' } }), 'https')
      expect(c.status).toBe('problem')
      expect(c.fix).toMatch(/HTTPS/)
    })
  })

  describe('own-origin', () => {
    const at = (hostname: string, pathname: string): DeploymentEnv => good({ location: { protocol: 'https:', hostname, pathname } })
    it('warns on github.io under a sub-path and names both fixes', async () => {
      const c = await check(at('me.github.io', '/hippo/'), 'own-origin')
      expect(c.status).toBe('warning')
      expect(c.fix).toMatch(/organisation/)
      expect(c.fix).toMatch(/custom domain/)
    })
    it('warns when the sub-path includes a file name', async () => {
      expect((await check(at('me.github.io', '/hippo/index.html'), 'own-origin')).status).toBe('warning')
    })
    it('is ok at the root of a github.io host', async () => {
      expect((await check(at('my-org.github.io', '/'), 'own-origin')).status).toBe('ok')
      expect((await check(at('my-org.github.io', '/index.html'), 'own-origin')).status).toBe('ok')
    })
    it('is ok on a custom domain, even under a path', async () => {
      expect((await check(at('hippo.example.org', '/app/'), 'own-origin')).status).toBe('ok')
    })
    it('is case-insensitive about the host', async () => {
      expect((await check(at('Me.GitHub.io', '/hippo/'), 'own-origin')).status).toBe('warning')
    })
    it('does not mistake a look-alike host for github.io', async () => {
      expect((await check(at('evilgithub.io', '/x/'), 'own-origin')).status).toBe('ok')
    })
  })

  describe('not-framed', () => {
    it('ok when not framed', async () => expect((await check(good(), 'not-framed')).status).toBe('ok'))
    it('problem when framed', async () => expect((await check(good({ framed: true }), 'not-framed')).status).toBe('problem'))
  })

  describe('service-worker', () => {
    it('ok when controlling', async () => expect((await check(good(), 'service-worker')).status).toBe('ok'))
    it('warning when supported but not controlling', async () => {
      const c = await check(good({ navigator: { serviceWorker: { controller: null } } }), 'service-worker')
      expect(c.status).toBe('warning')
      expect(c.fix).toMatch(/Reload/)
    })
    it('warning when unsupported', async () => {
      expect((await check(good({ navigator: {} }), 'service-worker')).status).toBe('warning')
    })
  })

  describe('indexeddb', () => {
    it('ok when the probe works', async () => expect((await check(good(), 'indexeddb')).status).toBe('ok'))
    it('problem when the probe says no', async () => {
      expect((await check(good({ probeIndexedDb: () => Promise.resolve(false) }), 'indexeddb')).status).toBe('problem')
    })
    it('problem when the probe rejects', async () => {
      expect((await check(good({ probeIndexedDb: () => Promise.reject(new Error('x')) }), 'indexeddb')).status).toBe('problem')
    })
    it('problem when there is no probe', async () => {
      expect((await check(good({ probeIndexedDb: undefined }), 'indexeddb')).status).toBe('problem')
    })
  })

  describe('persistent-storage', () => {
    const withPersisted = (persisted?: () => Promise<boolean>): DeploymentEnv =>
      good({ navigator: { onLine: true, serviceWorker: { controller: {} }, storage: persisted ? { persisted } : {} } })
    it('ok when granted', async () => expect((await check(withPersisted(() => Promise.resolve(true)), 'persistent-storage')).status).toBe('ok'))
    it('warning when not granted', async () => {
      const c = await check(withPersisted(() => Promise.resolve(false)), 'persistent-storage')
      expect(c.status).toBe('warning')
      expect(c.fix).toMatch(/backup/)
    })
    it('unknown when the API is missing', async () => expect((await check(withPersisted(), 'persistent-storage')).status).toBe('unknown'))
    it('unknown when no storage object exists', async () => {
      expect((await check(good({ navigator: {} }), 'persistent-storage')).status).toBe('unknown')
    })
    it('unknown when the call rejects', async () => {
      expect((await check(withPersisted(() => Promise.reject(new Error('x'))), 'persistent-storage')).status).toBe('unknown')
    })
    it('unknown when it answers with something other than a boolean', async () => {
      const weird = (() => Promise.resolve('yes')) as unknown as () => Promise<boolean>
      expect((await check(withPersisted(weird), 'persistent-storage')).status).toBe('unknown')
    })
  })

  describe('relays', () => {
    const relays = ['wss://a.example', 'wss://b.example', 'wss://c.example']
    it('ok when all answer, and closes every socket', async () => {
      const closed: string[] = []
      const c = await check(good({ relays, createWebSocket: socketFactory({ 'wss://a.example': 'open', 'wss://b.example': 'open', 'wss://c.example': 'open' }, [], closed) }), 'relays')
      expect(c.status).toBe('ok')
      expect(c.finding).toBe('3 of 3 relays answered.')
      expect(closed.sort()).toEqual(relays)
    })
    it('warning when some answer; error, close, throw and hang all count as failures', async () => {
      const c = await check(
        good({ relays: [...relays, 'wss://d.example', 'wss://e.example'], createWebSocket: socketFactory({ 'wss://a.example': 'open', 'wss://b.example': 'error', 'wss://c.example': 'close', 'wss://d.example': 'throw', 'wss://e.example': 'hang' }) }),
        'relays',
      )
      expect(c.status).toBe('warning')
      expect(c.finding).toContain('1 of 5 relays answered')
    })
    it('problem when none answer, and does not hang on a silent relay', async () => {
      const started = Date.now()
      const c = await check(good({ relays: ['wss://a.example'], createWebSocket: socketFactory({}), relayTimeoutMs: 150 }), 'relays')
      expect(c.status).toBe('problem')
      expect(c.finding).toContain('0 of 1 relay answered')
      expect(Date.now() - started).toBeLessThan(2000)
    })
    it('problem when no relays are configured', async () => {
      expect((await check(good({ relays: [] }), 'relays')).status).toBe('problem')
    })
    it('unknown without a WebSocket factory', async () => {
      expect((await check(good({ createWebSocket: undefined }), 'relays')).status).toBe('unknown')
    })
    it('unknown while offline, without opening sockets', async () => {
      const opened: string[] = []
      const c = await check(good({ navigator: { onLine: false }, createWebSocket: socketFactory({}, opened) }), 'relays')
      expect(c.status).toBe('unknown')
      expect(opened).toEqual([])
    })
    it('ignores a late answer after the timeout', async () => {
      let late: ProbeSocket | undefined
      const c = await check(
        good({
          relays: ['wss://a.example'],
          relayTimeoutMs: 100,
          createWebSocket: () => {
            late = { onopen: null, onerror: null, onclose: null, close() {} }
            return late
          },
        }),
        'relays',
      )
      expect(c.status).toBe('problem')
      expect(late?.onopen).toBeNull()
    })
  })

  it('never throws, even for a hostile environment', async () => {
    const hostile = {
      get location(): never {
        throw new Error('boom')
      },
      framed: false,
      navigator: {},
      relays: [],
    } as unknown as DeploymentEnv
    const all = await checkDeployment(hostile)
    expect(all).toHaveLength(7)
    expect(all.find((c) => c.id === 'https')?.status).toBe('unknown')
  })
})
