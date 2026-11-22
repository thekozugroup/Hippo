// Giver sessions: open a list from a share link (or a remembered topic) and
// expose its live view through useSyncExternalStore.

import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  addGuestListFromLink,
  isHippoError,
  listSharedLists,
  openGuestList,
  parseShareLink,
  topicOfList,
  type GiverListSession,
  type GiverListView,
} from '../../core/index.ts'
import type { Core } from '../../core/index.ts'
import { useCore } from './context.ts'

export type GiverSource = { kind: 'link'; payload: string } | { kind: 'topic'; topic: string }

export type GiverOpenState =
  | { kind: 'opening' }
  | { kind: 'ready'; session: GiverListSession }
  | { kind: 'invalid-link' }
  | { kind: 'own-list'; listId?: string }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }

/** The id of the list this device owns for a link or topic, if any (FR-25). */
async function ownListIdFor(core: Core, source: GiverSource): Promise<string | undefined> {
  let topic: string
  if (source.kind === 'topic') topic = source.topic
  else {
    try {
      topic = topicOfList(parseShareLink(source.payload))
    } catch {
      return undefined
    }
  }
  const lists = await listSharedLists(core.db)
  return lists.find((l) => topicOfList(l) === topic)?.id
}

async function open(core: Core, source: GiverSource): Promise<GiverListSession> {
  const topic = source.kind === 'topic' ? source.topic : (await addGuestListFromLink(core, source.payload)).topic
  return openGuestList(core, topic)
}

export function useGiverSession(source: GiverSource): GiverOpenState {
  const core = useCore()
  const kind = source.kind
  const value = source.kind === 'topic' ? source.topic : source.payload
  const key = `${kind}:${value}`
  const [state, setState] = useState<{ key: string; value: GiverOpenState }>({ key, value: { kind: 'opening' } })

  useEffect(() => {
    const src: GiverSource = kind === 'topic' ? { kind, topic: value } : { kind, payload: value }
    const key = `${kind}:${value}`
    let cancelled = false
    let session: GiverListSession | null = null
    open(core, src)
      .then(async (s) => {
        if (cancelled) return
        session = s
        setState({ key, value: { kind: 'ready', session: s } })
        await s.start()
      })
      .catch(async (e: unknown) => {
        if (cancelled) return
        let value: GiverOpenState
        if (isHippoError(e, 'invalid-link')) value = { kind: 'invalid-link' }
        else if (isHippoError(e, 'own-list')) {
          const listId = await ownListIdFor(core, src)
          value = listId ? { kind: 'own-list', listId } : { kind: 'own-list' }
        } else if (isHippoError(e, 'not-found')) value = { kind: 'not-found' }
        else value = { kind: 'error', message: e instanceof Error ? e.message : String(e) }
        if (!cancelled) setState({ key, value })
      })
    return () => {
      cancelled = true
      session?.stop()
    }
  }, [core, kind, value])

  return state.key === key ? state.value : { kind: 'opening' }
}

const noopSubscribe = (): (() => void) => () => undefined
const nullSnapshot = (): null => null

export function useGiverView(session: GiverListSession | null): GiverListView | null {
  return useSyncExternalStore<GiverListView | null>(session?.subscribe ?? noopSubscribe, session?.getSnapshot ?? nullSnapshot)
}
