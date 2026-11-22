import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import App from './App.tsx'
import { getAppCore } from './app/core/core.ts'
import { handleStartupCapture } from './app/core/capture.ts'
import { applyTheme, readStoredTheme } from './app/core/theme.ts'
import { blockIfFramed } from './core/services/frame-guard.ts'

// GitHub Pages cannot send frame-ancestors, so refuse to run inside another
// site's frame: show a message and start nothing (no database, no relays).
if (!blockIfFramed(window, document, window.location.href)) {
  // Before the first render: pinned theme (no flash), relay override, then
  // share-target / deep-link capture, which also strips the query string.
  applyTheme(readStoredTheme())
  getAppCore()
  handleStartupCapture()

  const root = document.getElementById('root')
  if (!root) throw new Error('Missing #root element')

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
