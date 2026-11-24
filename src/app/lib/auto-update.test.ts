import template from '../../../scripts/hosting/hippo-update.yml?raw'
import readme from '../../../README.md?raw'
import vercelRaw from '../../../vercel.json?raw'
import { CSP, UPDATE_CHECK_ORIGIN } from '../../../vite.config.ts'
import {
  checkForUpdate,
  compareVersions,
  newWorkflowFileUrl,
  parseRepository,
  RAW_GITHUB_ORIGIN,
  STABLE_PACKAGE_URL,
  UPDATE_WORKFLOW_PATH,
  UPSTREAM_SLUG,
} from './auto-update.ts'
import { UPSTREAM_REPO_URL } from './hosting.ts'

describe('parseRepository', () => {
  it.each([
    ['ada/hippo', 'ada/hippo'],
    ['  Ada-Lovelace/my.hippo_site  ', 'Ada-Lovelace/my.hippo_site'],
    ['https://github.com/ada/hippo', 'ada/hippo'],
    ['github.com/ada/hippo.git', 'ada/hippo'],
    ['https://github.com/ada/hippo/', 'ada/hippo'],
    ['a/b', 'a/b'],
    [`${'a'.repeat(39)}/${'r'.repeat(100)}`, `${'a'.repeat(39)}/${'r'.repeat(100)}`],
  ])('accepts %j', (input, repository) => {
    expect(parseRepository(input)).toEqual({ ok: true, repository })
  })

  it.each([
    '',
    '   ',
    'hippo',
    'ada/hippo/extra',
    '/hippo',
    'ada/',
    '-ada/hippo',
    'ada-/hippo',
    'a--da/hippo',
    'ad a/hippo',
    'ada/hip po',
    'ada/..',
    'ada/.',
    'ada/hippo?x=1',
    'ada/hippo#x',
    'ad_a/hippo',
    `${'a'.repeat(40)}/hippo`,
    `ada/${'r'.repeat(101)}`,
    'https://gitlab.com/ada/hippo',
    'https://github.com.evil.example/ada/hippo',
    'ada/hippo%2F..',
    'ada/<script>',
  ])('refuses %j with a sentence', (input) => {
    const r = parseRepository(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/^[A-Z].*\.$/)
  })
})

describe('newWorkflowFileUrl', () => {
  it("opens GitHub's new-file page of that repository with the path and the exact template", () => {
    const url = new URL(newWorkflowFileUrl('ada/hippo', template))
    expect(url.origin).toBe('https://github.com')
    expect(url.pathname).toBe('/ada/hippo/new/main')
    expect(url.searchParams.get('filename')).toBe(UPDATE_WORKFLOW_PATH)
    expect(url.searchParams.get('value')).toBe(template)
    expect([...url.searchParams.keys()]).toEqual(['filename', 'value'])
  })

  it('stays well under the address length GitHub accepts', () => {
    // GitHub answers 414 above its (unpublished) limit; 8 KB is the common server default.
    expect(newWorkflowFileUrl('a'.repeat(39) + '/' + 'r'.repeat(100), template).length).toBeLessThan(6000)
  })

  it('is the link in the README, for OWNER/REPO (npm run hosting:link rewrites it)', () => {
    const link = newWorkflowFileUrl('OWNER/REPO', template)
    expect(readme).toContain(`(${link})`)
    expect(readme.match(/https:\/\/github\.com\/OWNER\/REPO\/new\/main\?/g)).toHaveLength(1)
  })
})

describe('the workflow template', () => {
  it('names the original in one place, and it is the project address', () => {
    expect(template.match(/https:\/\/github\.com\/[^\s'"]+/g)).toEqual([`${UPSTREAM_REPO_URL}.git`])
    expect(template).toMatch(/^ {2}HIPPO_UPSTREAM_URL: /m)
  })

  it('asks for write access to contents and nothing else', () => {
    expect(template).toMatch(/^permissions:\n {2}contents: write\n\n/m)
    expect(template.match(/^\s*[a-z-]+: (write|read)$/gm)).toEqual(['  contents: write'])
  })

  it('pins every action to a full commit id', () => {
    const uses = template.match(/uses: \S+/g) ?? []
    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/)
  })

  it('runs daily, by hand and once when the file is added; runs the script from the fetched original', () => {
    expect(template).toMatch(/schedule:\n\s+- cron: '\d+ \d+ \* \* \*'/)
    expect(template).toContain('workflow_dispatch:')
    expect(template).toContain(`paths: ['${UPDATE_WORKFLOW_PATH}']`)
    expect(template).toContain('git show FETCH_HEAD:scripts/hosting/update-copy.sh')
    expect(template).toContain('fetch-depth: 0')
    expect(template).toContain('concurrency:')
  })

  it('says what it trusts and how to stop it', () => {
    expect(template).toMatch(/Trust:/)
    expect(template).toMatch(/delete this file/i)
    expect(template).toMatch(/Disable workflow/)
  })
})

describe('compareVersions', () => {
  it.each([
    ['0.1.4', '0.1.5', -1],
    ['0.1.5', '0.1.5', 0],
    ['0.2.0', '0.1.9', 1],
    ['0.1.10', '0.1.9', 1],
    ['1.0.0', '0.99.99', 1],
    ['v1.2.3', '1.2.3', 0],
    ['1.0.0-beta.1', '1.0.0', -1],
    ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-alpha.2', '1.0.0-alpha.10', -1],
    ['1.0.0-1', '1.0.0-alpha', -1],
    ['1.0.0+build.5', '1.0.0', 0],
  ] as const)('%s against %s gives %d', (a, b, want) => {
    expect(compareVersions(a, b)).toBe(want)
  })

  it.each([['', '1.0.0'], ['1.0', '1.0.0'], ['1.0.0', 'latest'], ['1.0.0.0', '1.0.0'], ['01.0.0x', '1.0.0']])('gives null for %j against %j', (a, b) => {
    expect(compareVersions(a, b)).toBeNull()
  })
})

describe('checkForUpdate', () => {
  const answer = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response)

  it("reads the original's stable package.json, without cookies or referrer", async () => {
    const f = answer({ version: '0.1.6' })
    expect(await checkForUpdate('0.1.5', f)).toEqual({ status: 'behind', latest: '0.1.6' })
    expect(STABLE_PACKAGE_URL).toBe(`https://raw.githubusercontent.com/${UPSTREAM_SLUG}/stable/package.json`)
    expect(UPSTREAM_SLUG).toBe('thekozugroup/Hippo')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(STABLE_PACKAGE_URL)
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
  })

  it('says up to date, newer, or why it could not tell', async () => {
    expect(await checkForUpdate('0.1.6', answer({ version: '0.1.6' }))).toEqual({ status: 'current', latest: '0.1.6' })
    expect(await checkForUpdate('0.2.0', answer({ version: '0.1.6' }))).toEqual({ status: 'ahead', latest: '0.1.6' })
    expect(await checkForUpdate('0.1.6', answer({}, false))).toEqual({ status: 'failed', reason: 'unreadable' })
    expect(await checkForUpdate('0.1.6', answer({ version: 7 }))).toEqual({ status: 'failed', reason: 'unreadable' })
    expect(await checkForUpdate('0.1.6', answer(null))).toEqual({ status: 'failed', reason: 'unreadable' })
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await checkForUpdate('0.1.6', offline)).toEqual({ status: 'failed', reason: 'offline' })
  })
})

describe('the content policy', () => {
  it('allows exactly the version check host on GitHub, in the page and in vercel.json', () => {
    expect(UPDATE_CHECK_ORIGIN).toBe(RAW_GITHUB_ORIGIN)
    const connect = /connect-src ([^;]*)/.exec(CSP)?.[1]?.split(' ') ?? []
    expect(connect).toContain(RAW_GITHUB_ORIGIN)
    expect(connect.filter((s) => /github/.test(s))).toEqual([RAW_GITHUB_ORIGIN])
    expect(vercelRaw).toContain(`${RAW_GITHUB_ORIGIN} `)
  })
})
