// Writes the README's "Turn on automatic updates" link from the workflow template, so the two cannot
// drift apart (src/app/lib/auto-update.test.ts fails when they do). Run after editing the template:
//
//   npm run hosting:link            rewrite the link in README.md
//   npm run hosting:link -- --check exit 1 when README.md is out of date
//
// Needs Node 22.18 or newer (it imports a TypeScript file from src/app/lib).
import { readFileSync, writeFileSync } from 'node:fs'
import { newWorkflowFileUrl } from '../../src/app/lib/auto-update.ts'

const readmePath = new URL('../../README.md', import.meta.url)
const template = readFileSync(new URL('./hippo-update.yml', import.meta.url), 'utf8')
const link = newWorkflowFileUrl('OWNER/REPO', template)
const pattern = /https:\/\/github\.com\/OWNER\/REPO\/new\/main\?[^)\s]*/g

const readme = readFileSync(readmePath, 'utf8')
const found = readme.match(pattern) ?? []
if (found.length !== 1) {
  console.error(`README.md should contain exactly one link starting https://github.com/OWNER/REPO/new/main?, found ${found.length}.`)
  process.exit(1)
}
if (found[0] === link) {
  console.log(`README.md link is up to date (${link.length} characters).`)
} else if (process.argv.includes('--check')) {
  console.error('README.md link does not match scripts/hosting/hippo-update.yml. Run: npm run hosting:link')
  process.exit(1)
} else {
  writeFileSync(readmePath, readme.replace(pattern, link))
  console.log(`README.md link updated (${link.length} characters).`)
}
