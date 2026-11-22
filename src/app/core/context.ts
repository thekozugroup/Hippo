import { createContext, useContext } from 'react'
import type { Core } from '../../core/index.ts'

export const CoreContext = createContext<Core | null>(null)

export function useCore(): Core {
  const core = useContext(CoreContext)
  if (!core) throw new Error('useCore must be used inside <CoreProvider>')
  return core
}
