import { useEffect, useRef, useState } from 'react'
import { Bookmark, Copy, Download, ExternalLink, Globe, Link2, RotateCcw, Send, Tags, Upload } from 'lucide-react'
import { Button, LinkButton, SectionHeader, SegmentedControl, Switch, TextArea, TextField } from '../../../ui/index.ts'
import {
  DEFAULT_RELAYS,
  isRelayUrl,
  LIMITS,
  LINK_PREVIEW_DISCLOSURE,
  PAGE_LOOKUP_DISCLOSURE,
  setLinkPreviewEnabled,
  setPageLookupEnabled,
  setOnboarding,
  setOwnerName,
  setRelayOverride,
  setTheme,
  type Theme,
} from '../../../core/index.ts'
import { useCore } from '../../core/context.ts'
import { useLinkPreviewEnabled, usePageLookupEnabled, useSettings, useSharedLists } from '../../core/data.ts'
import { useNotify } from '../../core/notify.ts'
import { applyTheme } from '../../core/theme.ts'
import { newFlow, toStored } from '../../core/onboarding.ts'
import { writeSetupHint } from '../../core/setupHint.ts'
import { useLocation } from 'wouter'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { downloadBackup } from '../../lib/backup-file.ts'
import { appBaseUrl, bookmarkletCode, shortcutScript } from '../../lib/capture-tools.ts'
import { possessive } from '../../lib/format.ts'
import { BackupImport } from '../../lib/BackupImport.tsx'
import { SiteReachNote } from '../../lib/SiteReach.tsx'
import { UPSTREAM_REPO_URL } from '../../lib/hosting.ts'
import { hostLabel, useSiteAddress } from '../../lib/site-reach.ts'
import { resyncLists } from '../../lib/sync.ts'
import { CategoriesSheet } from '../CategoriesSheet.tsx'
import { moveWishesNote, whyInstall } from '../../pwa/guide.ts'
import { InstallGuide } from '../../pwa/InstallGuide.tsx'
import { useInstallGuide } from '../../pwa/useInstall.ts'
import { DeploymentChecks } from './DeploymentChecks.tsx'
import { isNativeApp } from '../../native/platform.ts'
import './SettingsScreen.css'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Relays end up in share links, so only public wss:// relays are allowed (same rule as core). */
function isRelayInput(s: string): boolean {
  return isRelayUrl(s)
}

/** The owner's name (shown to friends on shared lists) and a way to go through setup again. */
function ProfileSection() {
  const core = useCore()
  const notify = useNotify()
  const settings = useSettings()
  const lists = useSharedLists()
  const [, navigate] = useLocation()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const value = text ?? settings?.ownerName ?? ''
  const shown = value.replace(/\s+/g, ' ').trim()

  const save = async () => {
    if (saving) return
    if ([...shown].length > LIMITS.ownerName) {
      setError(`Use up to ${LIMITS.ownerName} characters.`)
      return
    }
    setError(undefined)
    setSaving(true)
    try {
      await setOwnerName(core.db, shown || undefined)
      setText(null)
      notify(shown ? `Saved. Friends see \u201c${possessive(shown)} list\u201d.` : 'Name removed. Friends see the list name only.')
      resyncLists(
        core,
        (lists ?? []).filter((l) => l.status === 'published').map((l) => l.id),
        notify,
      )
    } catch {
      setError('Could not save your name. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const replay = async () => {
    try {
      await setOnboarding(core.db, toStored(newFlow(settings?.ownerName ? { ownerName: settings.ownerName } : {}), Date.now()))
      writeSetupHint(false, core.db.name)
      navigate('/welcome/start')
    } catch {
      notify('Could not open setup. Please try again.')
    }
  }

  return (
    <section className="app-stack" aria-labelledby="set-profile">
      <h2 id="set-profile" className="app-section-title">
        You and setup
      </h2>
      <form
        className="app-stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <TextField
          label="First name or nickname"
          value={value}
          autoComplete="given-name"
          maxLength={LIMITS.ownerName * 2}
          onChange={(e) => setText(e.target.value)}
          hint={shown ? `Friends you share a list with see \u201c${possessive(shown)} list\u201d.` : 'Shown at the top of lists you share. Leave it empty to show the list name only.'}
          {...(error ? { error } : {})}
        />
        <div>
          <Button type="submit" variant="secondary" size="md" loading={saving} disabled={text === null}>
            Save name
          </Button>
        </div>
      </form>
      <div className="app-stack app-stack--tight" aria-labelledby="set-setup">
        <h3 id="set-setup" className="field__label">
          Setup
        </h3>
        <p className="app-note">The first-run questions: your name, an occasion with a list, and a first wish.</p>
        <div>
          <Button type="button" variant="secondary" size="md" icon={<RotateCcw />} onClick={() => void replay()}>
            Go through setup again
          </Button>
        </div>
      </div>
    </section>
  )
}

function ThemeSection() {
  const { db } = useCore()
  const settings = useSettings()
  const theme = settings?.theme ?? 'system'
  const notify = useNotify()
  const change = async (t: Theme) => {
    applyTheme(t)
    try {
      await setTheme(db, t)
    } catch {
      notify('Could not save the theme on this device. It applies until you close Hippo.')
    }
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
  const core = useCore()
  const { db } = core
  const notify = useNotify()
  const settings = useSettings()
  const [exporting, setExporting] = useState(false)

  const doExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const outcome = await downloadBackup(db, core.now())
      if (outcome === 'saved') notify('Backup saved. Keep the file somewhere private.')
      else if (outcome === 'shared') notify('Backup file ready. Keep it somewhere private.')
    } catch {
      notify('The backup could not be saved. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const last = settings?.lastExportAt
  return (
    <section className="app-stack" aria-labelledby="set-backup">
      <h2 id="set-backup" className="app-section-title">
        Backup
      </h2>
      <p className="app-note">
        Hippo has no server copy of your wishes. Save a backup file to move to a new phone or to restore after losing one.
        {last ? ` Last backup: ${new Date(last).toLocaleDateString()}.` : ' You have not made a backup yet.'}
      </p>
      <p className="app-note">
        <strong>Keep the file private.</strong> It contains the keys to your shared lists.
      </p>
      <BackupImport>
        {(pick, busy) => (
          <div className="app-row app-row--fill">
            <Button variant="secondary" size="md" fullWidth icon={<Download />} loading={exporting} onClick={() => void doExport()}>
              Export backup
            </Button>
            <Button variant="secondary" size="md" fullWidth icon={<Upload />} disabled={busy} onClick={pick}>
              Import backup
            </Button>
          </div>
        )}
      </BackupImport>
    </section>
  )
}

/** Moving to another device without a file (a transfer link), both ways. */
function MoveSection() {
  return (
    <section className="app-stack" aria-labelledby="set-move">
      <h2 id="set-move" className="app-section-title">
        Another device
      </h2>
      <p className="app-note">Move your wishes and lists to another phone or browser with a link that works for 15 minutes. It is a one-time move: afterwards each device keeps its own copy.</p>
      <div className="app-row app-row--fill">
        <LinkButton href="#/move" variant="secondary" size="md" fullWidth icon={<Send />}>
          Move Hippo to another device
        </LinkButton>
        <LinkButton href="#/move/receive" variant="secondary" size="md" fullWidth icon={<Link2 />}>
          Enter a transfer link
        </LinkButton>
      </div>
    </section>
  )
}

/** The Android app: which Hippo website its links point at. */
function SiteSection() {
  const site = useSiteAddress()
  return (
    <section className="app-stack" aria-labelledby="set-site">
      <h2 id="set-site" className="app-section-title">
        Hippo site
      </h2>
      <p className="app-note">{`Links you share open on ${hostLabel(site)}.`}</p>
      <SiteReachNote what="links you share" />
      <div>
        <LinkButton href="#/site" variant="secondary" size="md" icon={<Globe />}>
          Use my own Hippo site
        </LinkButton>
      </div>
    </section>
  )
}

/** This device's way to install Hippo (or that it is installed), and for Home Screen apps, how to move wishes across. */
function InstallSection() {
  const { guide, installedHere } = useInstallGuide()
  const move = moveWishesNote(guide)
  const installed = guide.kind === 'installed' || installedHere
  return (
    <section className="app-stack" aria-labelledby="set-install">
      <h2 id="set-install" className="app-section-title">
        Install Hippo
      </h2>
      {installed ? null : <p className="app-note">{whyInstall(guide)}</p>}
      <InstallGuide guide={guide} installed={installedHere}>
        {move ? <p className="install-guide__note">{move}</p> : null}
      </InstallGuide>
    </section>
  )
}

/** Inside the Android app, Hippo is in the share sheet; the bookmarklet and Shortcut are for other devices. */
function AppCaptureSection() {
  return (
    <section className="app-stack" aria-labelledby="set-capture">
      <h2 id="set-capture" className="app-section-title">
        Add from other apps
      </h2>
      <p className="app-note">In any shop or browser, use Share and pick Hippo. The wish form opens with the link filled in.</p>
      <p className="app-note">You can also paste a link into Add a wish.</p>
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
        On Android, once Hippo is installed (see Install Hippo above), use the Share button in any shop or browser and pick Hippo.
      </p>

      <div className="app-stack app-stack--tight">
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

      <div className="app-stack app-stack--tight">
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
        <div className="settings-after">
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

/** The Android app reads shop pages itself, on the phone. On by default; the sentence is core's, unchanged. */
function PageLookupSection() {
  const { db } = useCore()
  const notify = useNotify()
  const enabled = usePageLookupEnabled()
  const change = async (on: boolean) => {
    try {
      await setPageLookupEnabled(db, on)
    } catch {
      notify('Could not save this setting. Please try again.')
    }
  }
  return (
    <section className="app-stack" aria-labelledby="set-lookup">
      <h2 id="set-lookup" className="app-section-title">
        Shop pages
      </h2>
      <Switch
        label="Fill in the name, picture and price"
        description={PAGE_LOOKUP_DISCLOSURE}
        checked={enabled === true}
        disabled={enabled === undefined}
        onChange={(e) => void change(e.target.checked)}
      />
    </section>
  )
}

/** Opt-in lookup of a link's title and picture. Off until switched on; the sentence is core's, unchanged. */
function LinkLookupSection() {
  const { db } = useCore()
  const notify = useNotify()
  const enabled = useLinkPreviewEnabled()
  const change = async (on: boolean) => {
    try {
      await setLinkPreviewEnabled(db, on)
    } catch {
      notify('Could not save this setting. Please try again.')
    }
  }
  return (
    <section className="app-stack" aria-labelledby="set-lookup">
      <h2 id="set-lookup" className="app-section-title">
        Link lookup
      </h2>
      <Switch
        label="Look up the title and picture of links"
        description={LINK_PREVIEW_DISCLOSURE}
        aria-describedby="set-lookup-limits"
        checked={enabled === true}
        disabled={enabled === undefined}
        onChange={(e) => void change(e.target.checked)}
      />
      <p id="set-lookup-limits" className="app-note">
        The free service only handles a few lookups a day, and it returns a title and a picture, not a price.
      </p>
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

  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (saving) return
    const lines = value
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const bad = lines.filter((l) => !isRelayInput(l))
    if (bad.length > 0) {
      setError(`Not a valid relay address: ${bad.slice(0, 2).join(', ')}. Use public addresses that start with wss://`)
      return
    }
    if (lines.length === 0) {
      setError('Add at least one relay, or use Reset to go back to the defaults.')
      return
    }
    setError(undefined)
    setSaving(true)
    try {
      await setRelayOverride(core.db, lines)
      setText(null)
      notify('Relays saved. New lists will use them.')
    } catch {
      setError('Could not save the relays. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    if (saving) return
    setSaving(true)
    try {
      await setRelayOverride(core.db, undefined)
      setText(null)
      setError(undefined)
      notify('Back to the default relays.')
    } catch {
      setError('Could not reset the relays. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="app-stack" aria-labelledby="set-relays">
      <h2 id="set-relays" className="app-section-title">
        Relays
      </h2>
      <p className="app-note">
        Shared lists travel as encrypted data through public Nostr relays, which cannot read them. Changes apply to lists you create from now on; existing links keep their relays.
      </p>
      {core.forcedRelays ? (
        <p className="app-banner" role="note">
          {`Test mode is on in this tab: every list uses only ${core.forcedRelays.join(', ')}.`}
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
      <div className="app-row app-row--fill">
        <Button variant="secondary" size="md" fullWidth onClick={() => void save()} loading={saving} disabled={text === null}>
          Save relays
        </Button>
        <Button variant="ghost" size="md" fullWidth onClick={() => void reset()} disabled={!settings?.relays && text === null}>
          Reset to defaults
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
        <li>Shared lists, and who is getting or chipping in on what, are end-to-end encrypted. The key is in the link, which is never sent to any server.</li>
        <li>Hiding gifts from you, the owner, is done by the Hippo app, not by encryption: Hippo cannot stop you from opening your own link in another browser. Please do not peek.</li>
        <li>Chipping in is a promise between friends. Hippo never handles money.</li>
        <li>
          {isNativeApp()
            ? 'The only other requests Hippo makes are for pictures you attach to wishes, for the shop pages of links you add (if that is on), and to the Hippo website to check the time.'
            : 'The only other requests Hippo makes are for pictures you attach to wishes, and for link lookups if you turn them on.'}
        </li>
      </ul>
      <div className="app-row">
        <a className="btn btn--secondary btn--md" href={UPSTREAM_REPO_URL} target="_blank" rel="noopener noreferrer">
          <span className="btn__icon" aria-hidden="true">
            <ExternalLink />
          </span>
          <span className="btn__label">
            View source code<span className="sr-only"> (opens in a new tab)</span>
          </span>
        </a>
      </div>
    </section>
  )
}

export default function SettingsScreen() {
  const [manage, setManage] = useState(false)
  return (
    <AppScreen nav="settings" title="Settings">
      <ProfileSection />
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
      {isNativeApp() ? null : <InstallSection />}
      <BackupSection />
      <MoveSection />
      {isNativeApp() ? <SiteSection /> : null}
      {isNativeApp() ? <AppCaptureSection /> : <CaptureSection />}
      {isNativeApp() ? <PageLookupSection /> : <LinkLookupSection />}
      <RelaySection />
      <AboutSection />
      <DeploymentChecks />
      <CategoriesSheet open={manage} onClose={() => setManage(false)} />
    </AppScreen>
  )
}
