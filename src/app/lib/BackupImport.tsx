// Importing a backup file: the hidden file picker, reading and checking the file, the "Import this
// backup?" sheet, and the import itself. Used by Settings and by "I already use Hippo" in setup.
// In the Android app the picker is the system's document picker (the WebView's file chooser).

import { useState, type ReactNode } from 'react'
import { BottomSheet, Button } from '../../ui/index.ts'
import { importData, isHippoError, listSharedLists, parseExportFile, setOnboarding, getSettings, type ExportFile, type ImportResult } from '../../core/index.ts'
import { useCore } from '../core/context.ts'
import { useNotify } from '../core/notify.ts'
import { writeSetupHint } from '../core/setupHint.ts'
import { isNativeApp } from '../native/platform.ts'
import { cameIn, plural } from './format.ts'
import { resyncLists } from './sync.ts'

/** Files larger than this are not Hippo backups. */
const MAX_BACKUP_FILE_BYTES = 20 * 1024 * 1024

export interface BackupImportProps {
  /** Renders the control that opens the file picker. */
  children: (pick: () => void, busy: boolean) => ReactNode
  /** Offer only "Add to what is here" (setup on a new device: there is nothing to replace). */
  mergeOnly?: boolean
  /** After a successful import; the toast has been shown. */
  onImported?: (r: ImportResult) => void
}

export function BackupImport({ children, mergeOnly = false, onImported }: BackupImportProps) {
  const core = useCore()
  const { db } = core
  const notify = useNotify()
  // The hidden input, kept in state (not a ref) because the picker control is rendered by the caller.
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null)
  const [pending, setPending] = useState<{ name: string; file: ExportFile } | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const onFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    setError(undefined)
    if (!file) return
    if (file.size > MAX_BACKUP_FILE_BYTES) {
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
      input.value = ''
    }
  }

  const doImport = async (mode: 'merge' | 'replace') => {
    if (!pending || busy) return
    setBusy(true)
    try {
      const r = await importData(db, pending.file, { mode, now: core.now() })
      setPending(null)
      // A restore is not a first run: Home opens with the restored data, not setup.
      const onboarding = (await getSettings(db)).onboarding
      if (!onboarding || onboarding.status === 'active') await setOnboarding(db, { status: 'completed', step: 0, answers: {}, updatedAt: core.now() })
      writeSetupHint(true, db.name)
      if (pending.file.settings.ownerName) {
        const shared = (await listSharedLists(db)).filter((l) => l.status === 'published').map((l) => l.id)
        resyncLists(core, shared, notify)
      }
      notify(`Imported ${cameIn(r.items, r.sharedLists + r.guestLists)}.`)
      onImported?.(r)
    } catch (e) {
      setError(
        isHippoError(e, 'invalid-import')
          ? `This backup was not imported because it contains one of your own lists as a list shared with you, or the other way round. Nothing was changed.`
          : 'The import failed. Nothing was changed.',
      )
    } finally {
      setBusy(false)
    }
  }

  const pick = () => fileInput?.click()
  return (
    <>
      {children(pick, busy)}
      <input
        ref={setFileInput}
        type="file"
        accept={isNativeApp() ? 'application/json,.json,text/plain,application/octet-stream' : 'application/json,.json'}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="import-file"
        onChange={(e) => void onFile(e.currentTarget)}
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
          {mergeOnly ? null : <p className="app-note">Add to what is here keeps your current wishes and updates any that are also in the file. Replace deletes everything on this device first.</p>}
          <Button variant="primary" fullWidth loading={busy} onClick={() => void doImport('merge')}>
            {mergeOnly ? 'Bring them in' : 'Add to what is here'}
          </Button>
          {mergeOnly ? null : (
            <Button variant="danger" fullWidth disabled={busy} onClick={() => void doImport('replace')}>
              Replace everything
            </Button>
          )}
        </div>
      </BottomSheet>
    </>
  )
}
