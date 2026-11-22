import { useEffect, useRef, useState } from 'react'
import { Bookmark, Copy, Download, ExternalLink, Tags, Upload } from 'lucide-react'
import { BottomSheet, Button, SectionHeader, SegmentedControl, TextArea } from '../../../ui/index.ts'
import {
  DEFAULT_RELAYS,
  exportData,
  importData,
  isHippoError,
  parseExportFile,
  setRelayOverride,
  setTheme,
  type ExportFile,
  type Theme,
} from '../../../core/index.ts'
import { useCore } from '../../core/context.ts'
import { useSettings } from '../../core/data.ts'
import { useNotify } from '../../core/notify.ts'
import { applyTheme } from '../../core/theme.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { appBaseUrl, bookmarkletCode, shortcutScript } from '../../lib/capture-tools.ts'
import { plural } from '../../lib/format.ts'
import { CategoriesSheet } from '../CategoriesSheet.tsx'
import './SettingsScreen.css'

const SOURCE_URL = 'https://github.com/thekozugroup/Hippo'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function isRelayInput(s: string): boolean {
  try {
    const u = new URL(s)
    if (u.protocol === 'wss:') return u.hostname.length > 0
    return u.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

function ThemeSection() {
  const { db } = useCore()
  const settings = useSettings()
  const theme = settings?.theme ?? 'system'
  const change = async (t: Theme) => {
    applyTheme(t)
    await setTheme(db, t)
  }
  return (
    <section className="app-stack" aria-labelledby="set-theme">
      <h2 id="set-theme" className="app-section-title">
        Appearance
      </h2>
      <SegmentedControl<Theme>
        label="Theme"
        value={theme}
        onChange={(t) => void change(t)}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
    </section>
  )
}

function BackupSection() {
  const { db } = useCore()
  const notify = useNotify()
  const settings = useSettings()
  const fileInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ name: string; file: ExportFile } | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const doExport = async () => {
    const data = await exportData(db)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hippo-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    notify('Backup saved. Keep the file somewhere private.')
  }

  const onFile = async (file: File | undefined) => {
    setError(undefined)
    if (!file) return
    if (file.size > 20 * 1024 * 1024) {
      setError('That file is too large to be a Hippo backup.')
      return
    }
    try {
      const parsed = parseExportFile(JSON.parse(await file.text()))
      setPending({ name: file.name, file: parsed })
    } catch (e) {
      setError(
        isHippoError(e, 'unsupported-version')
          ? 'This is not a Hippo backup, or it comes from a newer version of Hippo.'
          : isHippoError(e, 'invalid-import')
            ? `This backup file is damaged and was not imported (${e.message}).`
            : 'This file could not be read. Choose a Hippo backup file (.json).',
      )
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const doImport = async (mode: 'merge' | 'replace') => {
    if (!pending) return
    setBusy(true)
    try {
      const r = await importData(db, pending.file, { mode })
      setPending(null)
      notify(`Imported ${plural(r.items, 'wish', 'wishes')} and ${plural(r.sharedLists + r.guestLists, 'list', 'lists')}.`)
    } catch {
      setError('The import failed. Nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  const last = settings?.lastExportAt
  return (
    <section className="app-stack" aria-labelledby="set-backup">
      <h2 id="set-backup" className="app-section-title">
        Backup
      </h2>
      <p className="app-note">
        Everything lives on this device only. Save a backup file to move to a new phone or to restore after losing one.
        {last ? ` Last backup: ${new Date(last).toLocaleDateString()}.` : ' You have not made a backup yet.'}
      </p>
      <p className="app-note">
        <strong>Keep the file private.</strong> It contains the keys to your shared lists.
      </p>
      <div className="app-row app-row--nowrap">
        <Button variant="secondary" size="md" fullWidth icon={<Download />} onClick={() => void doExport()}>
          Export
        </Button>
        <Button variant="secondary" size="md" fullWidth icon={<Upload />} onClick={() => fileInput.current?.click()}>
          Import
        </Button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="import-file"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <BottomSheet
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Import this backup?"
        description={
          pending
            ? `${pending.name}: ${plural(pending.file.items.length, 'wish', 'wishes')}, ${plural(pending.file.categories.length, 'category', 'categories')}, ${plural(pending.file.sharedLists.length + pending.file.guestLists.length, 'list', 'lists')}.`
            : undefined
        }
      >
        <div className="app-stack">
          <p className="app-note">Add to what is here keeps your current wishes and updates any that are also in the file. Replace deletes everything on this device first.</p>
          <Button variant="primary" fullWidth loading={busy} onClick={() => void doImport('merge')}>
            Add to what is here
          </Button>
          <Button variant="danger" fullWidth disabled={busy} onClick={() => void doImport('replace')}>
            Replace everything
          </Button>
        </div>
      </BottomSheet>
    </section>
  )
}

function CaptureSection() {
  const notify = useNotify()
  const appUrl = appBaseUrl()
  const bookmarklet = bookmarkletCode(appUrl)
  const script = shortcutScript(appUrl)
  const linkRef = useRef<HTMLAnchorElement>(null)

  // React refuses javascript: URLs in JSX, so the draggable bookmarklet's
  // href is set directly. Clicking it here does nothing (the CSP blocks it).
  useEffect(() => {
    linkRef.current?.setAttribute('href', bookmarklet)
  }, [bookmarklet])

  return (
    <section className="app-stack" aria-labelledby="set-capture">
      <h2 id="set-capture" className="app-section-title">
        Add from other apps
      </h2>
      <p className="app-note">
        On Android and in Chrome or Edge on a computer, install Hippo (Add to Home screen or Install app), then use the Share button in any shop or browser and pick Hippo.
      </p>

      <div className="app-stack settings-card">
        <SectionHeader title="Bookmarklet for computers" level={3} />
        <p className="app-note">Drag this button to your bookmarks bar. On a shop page, click the bookmark to open Hippo with the page filled in.</p>
        <div className="app-row">
          <a ref={linkRef} className="btn btn--primary btn--md settings-bookmarklet" draggable="true" onClick={(e) => e.preventDefault()} aria-describedby="bm-hint">
            <span className="btn__icon" aria-hidden="true">
              <Bookmark />
            </span>
            <span className="btn__label">Add to Hippo</span>
          </a>
          <Button
            variant="ghost"
            size="md"
            icon={<Copy />}
            onClick={() => void copyText(bookmarklet).then((ok) => notify(ok ? 'Bookmarklet copied. Create a bookmark and paste it as the address.' : 'Copy did not work here.'))}
          >
            Copy code
          </Button>
        </div>
        <p id="bm-hint" className="app-note">
          Cannot drag? Copy the code, create a new bookmark and paste the code as its address.
        </p>
      </div>

      <div className="app-stack settings-card">
        <SectionHeader title="Shortcut for iPhone and iPad" level={3} />
        <ol className="app-steps">
          <li>
            <span>
              Open the <strong>Shortcuts</strong> app and tap <strong>+</strong> to make a new shortcut. Name it <strong>Add to Hippo</strong>.
            </span>
          </li>
          <li>
            <span>
              Tap the info button and turn on <strong>Show in Share Sheet</strong>. Set it to receive <strong>Safari web pages</strong>.
            </span>
          </li>
          <li>
            <span>
              Add the action <strong>Run JavaScript on Web Page</strong> and replace its code with the script below.
            </span>
          </li>
          <li>
            <span>
              Add the action <strong>Open URLs</strong> and choose <strong>JavaScript Result</strong> as the input.
            </span>
          </li>
          <li>
            <span>
              In Safari, tap <strong>Share</strong> on a product page, then <strong>Add to Hippo</strong>. The first time, allow the shortcut to run on that site.
            </span>
          </li>
        </ol>
        <pre className="app-code" tabIndex={0} role="region" aria-label="Shortcut script">
          {script}
        </pre>
        <div>
          <Button
            variant="secondary"
            size="md"
            icon={<Copy />}
            onClick={() => void copyText(script).then((ok) => notify(ok ? 'Script copied.' : 'Copy did not work here. Select the script and copy it.'))}
          >
            Copy script
          </Button>
        </div>
      </div>
    </section>
  )
}

function RelaySection() {
  const core = useCore()
  const notify = useNotify()
  const settings = useSettings()
  const current = settings?.relays ?? [...DEFAULT_RELAYS]
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const value = text ?? current.join('\n')

  const save = async () => {
    const lines = value
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const bad = lines.filter((l) => !isRelayInput(l))
    if (bad.length > 0) {
      setError(`Not a valid relay address: ${bad.slice(0, 2).join(', ')}. Use addresses that start with wss://`)
      return
    }
    if (lines.length === 0) {
      setError('Add at least one relay, or use Reset to go back to the defaults.')
      return
    }
    setError(undefined)
    await setRelayOverride(core.db, lines)
    setText(null)
    notify('Relays saved. New lists will use them.')
  }

  const reset = async () => {
    await setRelayOverride(core.db, undefined)
    setText(null)
    setError(undefined)
    notify('Back to the default relays.')
  }

  return (
    <section className="app-stack" aria-labelledby="set-relays">
      <h2 id="set-relays" className="app-section-title">
        Relays
      </h2>
      <p className="app-note">
        Shared lists travel through public Nostr relays as encrypted data. Relays cannot read your lists. Changes here apply to lists you create from now on; existing links keep their relays.
      </p>
      {core.forcedRelays ? (
        <p className="app-banner" role="note">
          {`Test mode is on: every list on this device uses only ${core.forcedRelays.join(', ')}.`}
        </p>
      ) : null}
      <TextArea
        label="Relay addresses, one per line"
        value={value}
        rows={6}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => setText(e.target.value)}
        {...(error ? { error } : {})}
      />
      <div className="app-row app-row--nowrap">
        <Button variant="secondary" size="md" fullWidth onClick={() => void save()} disabled={text === null}>
          Save relays
        </Button>
        <Button variant="ghost" size="md" fullWidth onClick={() => void reset()} disabled={!settings?.relays && text === null}>
          Reset
        </Button>
      </div>
    </section>
  )
}

function AboutSection() {
  return (
    <section className="app-stack" aria-labelledby="set-about">
      <h2 id="set-about" className="app-section-title">
        About and privacy
      </h2>
      <ul className="settings-facts">
        <li>No accounts, no tracking, no ads. Hippo is a free, open-source app (MIT licence).</li>
        <li>Your wishlist is stored only on this device until you share a list.</li>
        <li>Shared lists and gift marks are end-to-end encrypted. The key is in the link, which is never sent to any server.</li>
        <li>Friends with the link see each other&apos;s marks and nicknames. You, the owner, do not, so gifts stay a surprise.</li>
        <li>Pledges are records only. Hippo never handles money.</li>
        <li>The only other requests Hippo makes are for pictures you attach to wishes.</li>
      </ul>
      <p className="app-note">Hippo hides gift marks from you, but it cannot stop you from opening your own link in another browser. Please do not peek.</p>
      <div className="app-row">
        <a className="btn btn--secondary btn--md" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          <span className="btn__icon" aria-hidden="true">
            <ExternalLink />
          </span>
          <span className="btn__label">
            Source code<span className="sr-only"> (opens in a new tab)</span>
          </span>
        </a>
        <a className="app-text-link" href="#/design">
          Design gallery
        </a>
      </div>
    </section>
  )
}

export default function SettingsScreen() {
  const [manage, setManage] = useState(false)
  return (
    <AppScreen nav="settings" title="Settings">
      <ThemeSection />
      <section className="app-stack" aria-labelledby="set-cats">
        <h2 id="set-cats" className="app-section-title">
          Categories
        </h2>
        <div>
          <Button variant="secondary" size="md" icon={<Tags />} onClick={() => setManage(true)}>
            Manage categories
          </Button>
        </div>
      </section>
      <BackupSection />
      <CaptureSection />
      <RelaySection />
      <AboutSection />
      <CategoriesSheet open={manage} onClose={() => setManage(false)} />
    </AppScreen>
  )
}
