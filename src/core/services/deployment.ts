// Deployment checks (README "Run your own copy"). Looks at the environment the
// app runs in and reports what is safe, what is weak and what is broken, in
// sentences a non-expert can act on. Everything it needs is injected, so each
// branch is tested without a browser. It never throws.

export type CheckStatus = 'ok' | 'warning' | 'problem' | 'unknown'

export type DeploymentCheckId =
  | 'https'
  | 'own-origin'
  | 'not-framed'
  | 'service-worker'
  | 'indexeddb'
  | 'persistent-storage'
  | 'relays'

export interface DeploymentCheck {
  id: DeploymentCheckId
  status: CheckStatus
  /** One plain-English sentence saying what was found. */
  finding: string
  /** One plain-English sentence saying what to do. Empty when `status` is `ok`. */
  fix: string
}

/** The part of a WebSocket the relay probe uses. */
export interface ProbeSocket {
  onopen: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
  onclose: ((ev: unknown) => void) | null
  close(): void
}

export interface DeploymentEnv {
  location: { protocol: string; hostname: string; pathname: string }
  /** False when `window.top !== window.self` (see `isFramed`). */
  framed: boolean
  navigator: {
    onLine?: boolean
    serviceWorker?: { controller: unknown } | undefined
    storage?: { persisted?: () => Promise<boolean> } | undefined
  }
  /** Opens and closes a scratch database; resolves true when that worked. Omit when IndexedDB is missing. */
  probeIndexedDb?: (() => Promise<boolean>) | undefined
  /** Creates a WebSocket for a relay URL. Omit when the environment has none. */
  createWebSocket?: ((url: string) => ProbeSocket) | undefined
  relays: readonly string[]
  /** How long to wait for each relay, default 4000 ms. */
  relayTimeoutMs?: number
}

const DEFAULT_RELAY_TIMEOUT_MS = 4000

function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]' || h === '::1'
}

function checkHttps(env: DeploymentEnv): DeploymentCheck {
  const { protocol, hostname } = env.location
  if (protocol === 'https:') return { id: 'https', status: 'ok', finding: 'This page is served over HTTPS.', fix: '' }
  if (protocol === 'http:' && isLocalHost(hostname)) {
    return { id: 'https', status: 'ok', finding: 'This page runs on your own computer, where plain HTTP is fine for testing.', fix: '' }
  }
  return {
    id: 'https',
    status: 'problem',
    finding: 'This page is not served over HTTPS, so the browser will not install it or keep its data safe.',
    fix: 'Open the HTTPS address of your site, and turn on "Enforce HTTPS" in the repository settings under Pages.',
  }
}

/** The folder part of a path: "/hippo/index.html" and "/hippo/" both give "/hippo/". */
function appBasePath(pathname: string): string {
  const segments = pathname.split('/').filter((s) => s.length > 0)
  const last = segments.at(-1)
  if (last !== undefined && last.includes('.')) segments.pop()
  return segments.length === 0 ? '/' : `/${segments.join('/')}/`
}

function checkOwnOrigin(env: DeploymentEnv): DeploymentCheck {
  const host = env.location.hostname.toLowerCase()
  if (host.endsWith('.github.io')) {
    if (appBasePath(env.location.pathname) !== '/') {
      return {
        id: 'own-origin',
        status: 'warning',
        finding: `Hippo runs under a sub-path of ${host}, and every other GitHub Pages site of this account shares its browser storage, including your list keys.`,
        fix: 'Publish Hippo from a GitHub organisation whose only Pages site is Hippo, so it gets its own address <organisation>.github.io, or attach a custom domain.',
      }
    }
    return {
      id: 'own-origin',
      status: 'ok',
      finding: `Hippo is at the top of ${host}, which is its own address as long as no other Pages site of this account exists.`,
      fix: '',
    }
  }
  return { id: 'own-origin', status: 'ok', finding: `Hippo has an address of its own (${host || 'this host'}).`, fix: '' }
}

function checkNotFramed(env: DeploymentEnv): DeploymentCheck {
  if (!env.framed) return { id: 'not-framed', status: 'ok', finding: 'Hippo is not inside another site.', fix: '' }
  return {
    id: 'not-framed',
    status: 'problem',
    finding: 'Hippo is shown inside another site, which could watch or steer what you do.',
    fix: 'Open Hippo in its own tab and do not use it from the framing site.',
  }
}

function checkServiceWorker(env: DeploymentEnv): DeploymentCheck {
  const sw = env.navigator.serviceWorker
  if (sw === undefined || sw === null) {
    return {
      id: 'service-worker',
      status: 'warning',
      finding: 'This browser, or this address, does not support service workers, so Hippo cannot work offline or be installed.',
      fix: 'Use a current browser and an HTTPS address.',
    }
  }
  if (sw.controller) return { id: 'service-worker', status: 'ok', finding: 'The service worker is running, so Hippo can open offline.', fix: '' }
  return {
    id: 'service-worker',
    status: 'warning',
    finding: 'The service worker is not controlling this page yet, so offline use is not ready.',
    fix: 'Reload the page once; if this stays, check that the site was built and published by the deploy workflow.',
  }
}

async function checkIndexedDb(env: DeploymentEnv): Promise<DeploymentCheck> {
  const bad: DeploymentCheck = {
    id: 'indexeddb',
    status: 'problem',
    finding: 'This browser cannot store data for Hippo (IndexedDB is unavailable), so your wishlist cannot be saved.',
    fix: 'Leave private browsing, allow site data for this address, or use another browser.',
  }
  if (!env.probeIndexedDb) return bad
  try {
    return (await env.probeIndexedDb()) === true
      ? { id: 'indexeddb', status: 'ok', finding: 'The browser can store data for Hippo.', fix: '' }
      : bad
  } catch {
    return bad
  }
}

async function checkPersistence(env: DeploymentEnv): Promise<DeploymentCheck> {
  const persisted = env.navigator.storage?.persisted
  const unknown: DeploymentCheck = {
    id: 'persistent-storage',
    status: 'unknown',
    finding: 'This browser does not say whether it will keep Hippo\'s data when it runs low on space.',
    fix: 'Keep a recent backup from Settings.',
  }
  if (typeof persisted !== 'function') return unknown
  try {
    const result = await persisted.call(env.navigator.storage)
    if (result === true) {
      return { id: 'persistent-storage', status: 'ok', finding: 'The browser has promised to keep Hippo\'s data.', fix: '' }
    }
    if (result === false) {
      return {
        id: 'persistent-storage',
        status: 'warning',
        finding: 'The browser may delete Hippo\'s data when the device runs low on space.',
        fix: 'Install Hippo to your home screen or bookmark it, and keep a recent backup from Settings.',
      }
    }
    return unknown
  } catch {
    return unknown
  }
}

/** Opens a socket to one relay. Resolves true if it opened, false on error, close or timeout. Never rejects. */
function probeRelay(create: (url: string) => ProbeSocket, url: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let socket: ProbeSocket | undefined
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        if (socket) {
          socket.onopen = null
          socket.onerror = null
          socket.onclose = null
          socket.close()
        }
      } catch {
        // Closing a socket that never opened can throw; nothing to do.
      }
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    try {
      socket = create(url)
      socket.onopen = () => finish(true)
      socket.onerror = () => finish(false)
      socket.onclose = () => finish(false)
    } catch {
      finish(false)
    }
  })
}

async function checkRelays(env: DeploymentEnv): Promise<DeploymentCheck> {
  const total = env.relays.length
  if (total === 0) {
    return {
      id: 'relays',
      status: 'problem',
      finding: 'No relays are configured, so shared lists and claims cannot be stored.',
      fix: 'Add relays to DEFAULT_RELAYS in src/core/config.ts and publish again.',
    }
  }
  if (!env.createWebSocket) {
    return { id: 'relays', status: 'unknown', finding: 'This environment cannot open WebSocket connections, so relays were not tested.', fix: 'Run the check in a current browser.' }
  }
  if (env.navigator.onLine === false) {
    return { id: 'relays', status: 'unknown', finding: 'The device is offline, so relays were not tested.', fix: 'Connect to the internet and run the check again.' }
  }
  const timeout = Math.min(Math.max(env.relayTimeoutMs ?? DEFAULT_RELAY_TIMEOUT_MS, 100), 30_000)
  const create = env.createWebSocket
  const results = await Promise.all(env.relays.map((r) => probeRelay(create, r, timeout)))
  const answered = results.filter(Boolean).length
  const noun = (n: number): string => (n === 1 ? 'relay' : 'relays')
  const counts = `${answered} of ${total} ${noun(total)} answered`
  if (answered === total) return { id: 'relays', status: 'ok', finding: `${counts}.`, fix: '' }
  if (answered === 0) {
    return {
      id: 'relays',
      status: 'problem',
      finding: `${counts}, so shared lists cannot be saved or read right now.`,
      fix: 'Check your internet connection, then see the relay health check in the repository Actions tab and update the relay list in src/core/config.ts.',
    }
  }
  return {
    id: 'relays',
    status: 'warning',
    finding: `${counts}; the others did not respond in time.`,
    fix: 'If this stays, check the weekly relay health check in the repository Actions tab and replace dead relays in src/core/config.ts.',
  }
}

/**
 * Runs every check. Order is fixed: https, own-origin, not-framed,
 * service-worker, indexeddb, persistent-storage, relays. Never throws and
 * never waits longer than the relay timeout.
 */
export async function checkDeployment(env: DeploymentEnv): Promise<DeploymentCheck[]> {
  const guard = async (id: DeploymentCheckId, run: () => DeploymentCheck | Promise<DeploymentCheck>): Promise<DeploymentCheck> => {
    try {
      return await run()
    } catch {
      return { id, status: 'unknown', finding: 'This check could not run.', fix: 'Reload the page and try again.' }
    }
  }
  return Promise.all([
    guard('https', () => checkHttps(env)),
    guard('own-origin', () => checkOwnOrigin(env)),
    guard('not-framed', () => checkNotFramed(env)),
    guard('service-worker', () => checkServiceWorker(env)),
    guard('indexeddb', () => checkIndexedDb(env)),
    guard('persistent-storage', () => checkPersistence(env)),
    guard('relays', () => checkRelays(env)),
  ])
}

function browserProbeSocket(url: string): ProbeSocket {
  const ws = new WebSocket(url)
  const probe: ProbeSocket = {
    onopen: null,
    onerror: null,
    onclose: null,
    close: () => ws.close(),
  }
  ws.onopen = (ev) => probe.onopen?.(ev)
  ws.onerror = (ev) => probe.onerror?.(ev)
  ws.onclose = (ev) => probe.onclose?.(ev)
  return probe
}

/** Builds the environment from the real browser globals. Call from the UI; tests build their own. */
export function browserDeploymentEnv(relays: readonly string[]): DeploymentEnv {
  const probe = (): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      try {
        const name = 'hippo-deployment-check'
        const req = indexedDB.open(name)
        req.onerror = () => resolve(false)
        req.onsuccess = () => {
          req.result.close()
          try {
            indexedDB.deleteDatabase(name)
          } catch {
            // The scratch database is harmless if it stays.
          }
          resolve(true)
        }
      } catch {
        resolve(false)
      }
    })
  let framed = true
  try {
    framed = window.top !== window.self
  } catch {
    framed = true
  }
  return {
    location: window.location,
    framed,
    navigator,
    probeIndexedDb: typeof indexedDB === 'undefined' ? undefined : probe,
    createWebSocket: typeof WebSocket === 'undefined' ? undefined : browserProbeSocket,
    relays,
  }
}
