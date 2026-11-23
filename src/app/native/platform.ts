// Is Hippo running inside the Android app? Two answers combined:
//
// 1. NATIVE_BUILD, a compile-time constant (vite.config.ts `define`). It is false in the website
//    build, so every branch that starts with `if (!NATIVE_BUILD) return` is dead code there and is
//    removed with the dynamic imports of plugin code behind it. The website bundle holds no
//    Capacitor code at all.
// 2. Capacitor's own runtime check, `Capacitor.isNativePlatform()`. The Android shell adds the
//    `Capacitor` global before the page's scripts run, so this needs no import. The app's web build
//    opened in a normal browser (the end-to-end check does this) therefore behaves as a website.
//
// This module imports nothing at run time, so anything may import it.

import type { CapacitorGlobal } from '@capacitor/core'

export const NATIVE_BUILD: boolean = __HIPPO_NATIVE__

type CapacitorProbe = Partial<Pick<CapacitorGlobal, 'isNativePlatform' | 'getPlatform'>>

/** The runtime half of the check, for tests: true when `scope.Capacitor` says this is a native platform. */
export function capacitorSaysNative(scope: { Capacitor?: CapacitorProbe } = globalThis as { Capacitor?: CapacitorProbe }): boolean {
  try {
    return scope.Capacitor?.isNativePlatform?.() === true
  } catch {
    return false
  }
}

let cached: boolean | undefined

/** True inside the Android app (never in the website build). Cached after the first call. */
export function isNativeApp(): boolean {
  if (!NATIVE_BUILD) return false
  cached ??= capacitorSaysNative()
  return cached
}
