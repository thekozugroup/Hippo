import { lazy, Suspense, useState } from 'react'
import { Circle, CircleCheck } from 'lucide-react'
import { List, ListRow, SectionHeader } from '../../ui/index.ts'
import { markSeen, type SharedList } from '../../core/index.ts'
import { useCore } from '../core/context.ts'
import { CHECKLIST_WISHES, type ChecklistTask } from '../core/onboarding.ts'
import { installTaskName, type InstallGuide } from '../pwa/guide.ts'

const InstallSheet = lazy(() => import('../pwa/InstallSheet.tsx'))

/**
 * "Get set up" on Home after first-run setup: tasks that track real state (Hippo installed where
 * that is possible, wishes on the device, a shared list, a saved recovery code). It goes away when all are
 * done or when hidden. The install task opens this device's steps in a sheet.
 */
export function SetupChecklist({
  tasks,
  wishes,
  lists,
  install,
}: {
  tasks: ChecklistTask[]
  wishes: number
  lists: readonly SharedList[]
  /** `openHref`: the Hippo Android app is installed here; the task opens it instead of the install steps. */
  install?: { guide: InstallGuide; installed: boolean; openHref?: string }
}) {
  const core = useCore()
  // null until first opened, so the sheet's code loads on first use and then stays mounted (focus returns to the row on close).
  const [sheet, setSheet] = useState<boolean | null>(null)
  const done = tasks.filter((t) => t.done).length
  const draft = lists.find((l) => l.status !== 'published')
  const text: Record<ChecklistTask['id'], { title: string; secondary?: string; href?: string }> = {
    install: install?.openHref
      ? { title: 'Open Hippo in the app', secondary: 'It is installed on this phone', href: install.openHref }
      : {
          title: install ? installTaskName(install.guide) : 'Install Hippo',
          secondary: install?.guide.kind === 'in-app' ? `Open Hippo in ${install.guide.realBrowser} first` : 'Opens like an app',
        },
    wishes: { title: 'Add three wishes', secondary: `${Math.min(wishes, CHECKLIST_WISHES)} of ${CHECKLIST_WISHES}`, href: '#/item/new' },
    share: { title: 'Share your list', secondary: 'Friends get a private link', href: draft ? `#/list/${draft.id}` : '#/list/new' },
    recovery: { title: 'Save your recovery code', secondary: 'Opens your wishlist on your other devices', href: '#/account/code' },
  }
  return (
    <section className="app-stack app-stack--tight" aria-labelledby="setup-checklist">
      <SectionHeader
        title={<span id="setup-checklist">{`Get set up · ${done} of ${tasks.length}`}</span>}
        action={{ label: 'Hide', onClick: () => void markSeen(core.db, 'setupChecklist', Date.now()) }}
      />
      <List aria-label="Setup tasks">
        {tasks.map((t) => {
          const d = text[t.id]
          return (
            <ListRow
              key={t.id}
              {...(t.done ? {} : d.href ? { href: d.href } : { onClick: () => setSheet(true) })}
              leading={
                <span key={String(t.done)} className={t.done ? 'setup-task__icon is-done motion-enter' : 'setup-task__icon'} aria-hidden="true">
                  {t.done ? <CircleCheck /> : <Circle />}
                </span>
              }
              title={
                <>
                  {d.title}
                  {t.done ? <span className="sr-only"> (done)</span> : null}
                </>
              }
              {...(t.done ? { secondary: 'Done' } : d.secondary ? { secondary: d.secondary } : {})}
            />
          )
        })}
      </List>
      {install && sheet !== null ? (
        <Suspense fallback={null}>
          <InstallSheet open={sheet} onClose={() => setSheet(false)} guide={install.guide} installed={install.installed} />
        </Suspense>
      ) : null}
    </section>
  )
}
