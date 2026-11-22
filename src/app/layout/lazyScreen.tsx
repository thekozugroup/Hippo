import { lazy, type ComponentType } from 'react'

export type LazyScreen<P extends object> = ComponentType<P> & { preload: () => Promise<void> }

/**
 * A code-split screen that can be loaded ahead of time. Once loaded it renders
 * directly, without suspending, so a route transition can land on the real
 * screen instead of a loading placeholder.
 */
export function lazyScreen<P extends object>(load: () => Promise<ComponentType<P>>): LazyScreen<P> {
  let loaded: ComponentType<P> | null = null
  let promise: Promise<void> | null = null
  const preload = (): Promise<void> => {
    promise ??= load().then(
      (c) => {
        loaded = c
      },
      (e: unknown) => {
        promise = null
        throw e
      },
    )
    return promise
  }
  const Lazy = lazy(async () => {
    await preload()
    if (!loaded) throw new Error('screen failed to load')
    return { default: loaded }
  })
  function Screen(props: P) {
    const C = loaded
    return C ? <C {...props} /> : <Lazy {...props} />
  }
  return Object.assign(Screen, { preload })
}
