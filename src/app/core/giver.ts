// Giver sessions: add a list from a share link, open a remembered list by
// topic, and expose its live view through useSyncExternalStore.

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

export type GiverProblem =
  | { kind: 'invalid-link' }
  | { kind: 'own-list'; listId?: string }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }

export type GiverOpenState = { kind: 'opening' } | { kind: 'ready'; session: GiverListSession } | GiverProblem

export type AddLinkState = { kind: 'opening' } | { kind: 'added'; topic: string } | GiverProblem

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

async function problemFor(core: Core, source: GiverSource, e: unknown): Promise<GiverProblem> {
  if (isHippoError(e, 'invalid-link')) return { kind: 'invalid-link' }
  if (isHippoError(e, 'own-list')) {
    const listId = await ownListIdFor(core, source)
    return listId ? { kind: 'own-list', listId } : { kind: 'own-list' }
  }
  if (isHippoError(e, 'not-found')) return { kind: 'not-found' }
  return { kind: 'error', message: e instanceof Error ? e.message : String(e) }
}

/**
 * Adds (or restores) the list behind a share link. The caller then replaces
 * the history entry with the remembered-list route, so the link's secret
 * does not stay in the address bar or history.
 */
export function useAddGuestLink(payload: string): AddLinkState {
  const core = useCore()
  const [state, setState] = useState<{ key: string; value: AddLinkState }>({ key: payload, value: { kind: 'opening' } })
  useEffect(() => {
    let cancelled = false
    addGuestListFromLink(core, payload).then(
      (g) => {
        if (!cancelled) setState({ key: payload, value: { kind: 'added', topic: g.topic } })
      },
      async (e: unknown) => {
        const value = await problemFor(core, { kind: 'link', payload }, e)
        if (!cancelled) setState({ key: payload, value })
      },
    )
    return () => {
      cancelled = true
    }
  }, [core, payload])
  return state.key === payload ? state.value : { kind: 'opening' }
}

/** Opens a remembered list shared with me and keeps its session running while mounted. */
export function useGiverSession(topic: string): GiverOpenState {
  const core = useCore()
  const [state, setState] = useState<{ key: string; value: GiverOpenState }>({ key: topic, value: { kind: 'opening' } })

  useEffect(() => {
    let cancelled = false
    let session: GiverListSession | null = null
    openGuestList(core, topic)
      .then(async (s) => {
        if (cancelled) {
          s.stop()
          return
        }
        session = s
        setState({ key: topic, value: { kind: 'ready', session: s } })
        await s.start()
      })
      .catch(async (e: unknown) => {
        if (cancelled) return
        const value = await problemFor(core, { kind: 'topic', topic }, e)
        if (!cancelled) setState({ key: topic, value })
      })
    return () => {
      cancelled = true
      session?.stop()
    }
  }, [core, topic])

  return state.key === topic ? state.value : { kind: 'opening' }
}

const noopSubscribe = (): (() => void) => () => undefined
const nullSnapshot = (): null => null

export function useGiverView(session: GiverListSession | null): GiverListView | null {
  return useSyncExternalStore<GiverListView | null>(session?.subscribe ?? noopSubscribe, session?.getSnapshot ?? nullSnapshot)
}
