import type { Ref, RefCallback } from 'react'

/** Assigns a node to any kind of ref (callback or object). */
export function assignRef<T>(ref: Ref<T> | undefined, node: T | null): void {
  if (typeof ref === 'function') ref(node)
  else if (ref) ref.current = node
}

/** Merges refs so a component can use its own ref and still forward the caller's (React 19 ref-as-prop). */
export function mergeRefs<T>(...refs: ReadonlyArray<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    for (const r of refs) assignRef(r, node)
  }
}
