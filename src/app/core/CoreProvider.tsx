import { useState, type ReactNode } from 'react'
import type { Core } from '../../core/index.ts'
import { CoreContext } from './context.ts'
import { getAppCore } from './core.ts'

/** Provides the app's Core. Tests pass their own (for example one backed by a MemoryTransport). */
export function CoreProvider({ core, children }: { core?: Core; children: ReactNode }) {
  const [value] = useState<Core>(() => core ?? getAppCore())
  return <CoreContext value={value}>{children}</CoreContext>
}
