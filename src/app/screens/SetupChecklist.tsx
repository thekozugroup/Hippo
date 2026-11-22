import { Circle, CircleCheck } from 'lucide-react'
import { List, ListRow, SectionHeader } from '../../ui/index.ts'
import { markSeen, type SharedList } from '../../core/index.ts'
import { useCore } from '../core/context.ts'
import { CHECKLIST_WISHES, type ChecklistTask } from '../core/onboarding.ts'

/**
 * "Get set up" on Home after first-run setup: three tasks that track real state (wishes on the
 * device, a shared list, a saved backup). It goes away when all are done or when hidden.
 */
export function SetupChecklist({ tasks, wishes, lists }: { tasks: ChecklistTask[]; wishes: number; lists: readonly SharedList[] }) {
  const core = useCore()
  const done = tasks.filter((t) => t.done).length
  const draft = lists.find((l) => l.status !== 'published')
  const text: Record<ChecklistTask['id'], { title: string; secondary?: string; href: string }> = {
    wishes: { title: 'Add three wishes', secondary: `${Math.min(wishes, CHECKLIST_WISHES)} of ${CHECKLIST_WISHES}`, href: '#/item/new' },
    share: { title: 'Share your list', secondary: 'Friends get a private link', href: draft ? `#/list/${draft.id}` : '#/list/new' },
    backup: { title: 'Save a backup', secondary: 'A file that brings your wishes back on any device', href: '#/settings' },
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
              {...(t.done ? {} : { href: d.href })}
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
    </section>
  )
}
