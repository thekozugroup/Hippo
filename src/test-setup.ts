import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'

// Each test is a fresh browser tab: tab-scoped state (unsaved form drafts) does not carry over.
afterEach(() => {
  try {
    globalThis.sessionStorage?.clear()
  } catch {
    // Not a browser environment.
  }
})
