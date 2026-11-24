// Automatic updates for copies of Hippo (README, "Turn on automatic updates"; scripts/hosting/).
//
// A copy turns them on by adding one workflow file, scripts/hosting/hippo-update.yml, to its own
// repository. This module builds the GitHub link that opens the new-file page with that file filled
// in, checks the repository name the owner types, and compares this copy's version with the one on
// the original's stable branch. The only request it makes is that one comparison, and only when the
// owner presses "Check for a newer version" (raw.githubusercontent.com, also in the content policy).

import { UPSTREAM_REPO_URL } from './hosting.ts'

/** Where the workflow file goes in the copy. */
export const UPDATE_WORKFLOW_PATH = '.github/workflows/hippo-update.yml'

/** The branch of the original that copies follow: it only moves to commits that passed every check. */
export const UPDATE_CHANNEL = 'stable'

/** The one GitHub host the app may contact, for the version check. Keep in step with the content policy in vite.config.ts. */
export const RAW_GITHUB_ORIGIN = 'https://raw.githubusercontent.com'

/** "thekozugroup/Hippo", from the project address in hosting.ts, so a fork that changes it checks itself. */
export const UPSTREAM_SLUG = new URL(UPSTREAM_REPO_URL).pathname.replace(/^\/+|\/+$/g, '')

/** The original's package.json on the stable branch: its "version" is the newest released version. */
export const STABLE_PACKAGE_URL = `${RAW_GITHUB_ORIGIN}/${UPSTREAM_SLUG}/${UPDATE_CHANNEL}/package.json`

/** The README section that explains automatic updates. */
export const AUTO_UPDATE_GUIDE_URL = `${UPSTREAM_REPO_URL}#turn-on-automatic-updates`

/** The workflow template on the original's stable branch, for people who prefer to copy it by hand. */
export const TEMPLATE_URL = `${UPSTREAM_REPO_URL}/blob/${UPDATE_CHANNEL}/scripts/hosting/hippo-update.yml`

/** GitHub account and organisation names: letters, digits and single hyphens inside, at most 39 characters. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/
/** Repository names: letters, digits, `.`, `_` and `-`, at most 100 characters, and not `.` or `..`. */
const REPO = /^[A-Za-z0-9._-]{1,100}$/

export type RepositoryInput = { ok: true; repository: string } | { ok: false; error: string }

/**
 * Reads what the owner typed as their repository: `name/repository`, for example `ada/hippo`. Also
 * accepts the repository's address on github.com, as copied from the browser. Spaces around it are
 * ignored; anything else that is not a valid GitHub name is refused with a sentence saying why.
 */
export function parseRepository(input: string): RepositoryInput {
  let text = input.trim()
  const address = /^(?:https:\/\/)?(?:www\.)?github\.com\/(.*)$/i.exec(text)
  if (address) text = (address[1] ?? '').replace(/\/+$/, '').replace(/\.git$/i, '')
  if (text === '') return { ok: false, error: 'Type your repository as name/repository, for example ada/hippo.' }
  const parts = text.split('/')
  if (parts.length !== 2) return { ok: false, error: 'Use exactly one slash: your GitHub name, then the repository, for example ada/hippo.' }
  const [owner = '', repo = ''] = parts
  if (!OWNER.test(owner)) return { ok: false, error: 'The part before the slash is not a valid GitHub name.' }
  if (!REPO.test(repo) || repo === '.' || repo === '..') return { ok: false, error: 'The part after the slash is not a valid repository name.' }
  return { ok: true, repository: `${owner}/${repo}` }
}

/**
 * GitHub's new-file page for `repository` (already checked by parseRepository), with the workflow's
 * path and content filled in. The owner presses "Commit changes" there. Spaces are sent as `+` and
 * everything else outside letters and digits percent-encoded, which keeps the link short.
 */
export function newWorkflowFileUrl(repository: string, template: string, branch = 'main'): string {
  const query = new URLSearchParams({ filename: UPDATE_WORKFLOW_PATH, value: template })
  return `https://github.com/${repository}/new/${encodeURIComponent(branch)}?${query.toString()}`
}

/** A version as numbers, plus the pre-release part (`1.2.0-beta.1`), or null when it is not one. */
function parseVersion(v: string): { core: [number, number, number]; pre: string[] } | null {
  const m = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim())
  if (!m) return null
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] }
}

/**
 * Compares two versions by semantic-version precedence: -1 when `a` is older than `b`, 0 when the
 * same, 1 when newer, null when either is not a version. A pre-release is older than its release.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  if (x.pre.length === 0 || y.pre.length === 0) {
    if (x.pre.length === y.pre.length) return 0
    return x.pre.length === 0 ? 1 : -1
  }
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) {
      const d = Number(p) - Number(q)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (pn !== qn) {
      return pn ? -1 : 1
    } else if (p !== q) {
      return p < q ? -1 : 1
    }
  }
  return 0
}

export type UpdateCheck =
  | { status: 'behind' | 'current' | 'ahead'; latest: string }
  | { status: 'failed'; reason: 'offline' | 'unreadable' }

const CHECK_TIMEOUT_MS = 10_000

/**
 * Asks the original's stable branch for its version and compares it with `current`. Never throws.
 * Sends no cookies and no referrer. `fetchImpl` is for tests.
 */
export async function checkForUpdate(current: string, fetchImpl: typeof fetch = fetch): Promise<UpdateCheck> {
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController()
  const timer = setTimeout(() => controller?.abort(), CHECK_TIMEOUT_MS)
  try {
    const res = await fetchImpl(STABLE_PACKAGE_URL, {
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      ...(controller ? { signal: controller.signal } : {}),
    })
    if (!res.ok) return { status: 'failed', reason: 'unreadable' }
    const body: unknown = await res.json()
    const latest = typeof body === 'object' && body !== null && 'version' in body && typeof body.version === 'string' ? body.version : ''
    const order = compareVersions(current, latest)
    if (order === null) return { status: 'failed', reason: 'unreadable' }
    return { status: order < 0 ? 'behind' : order === 0 ? 'current' : 'ahead', latest }
  } catch (e) {
    return { status: 'failed', reason: e instanceof SyntaxError ? 'unreadable' : 'offline' }
  } finally {
    clearTimeout(timer)
  }
}
