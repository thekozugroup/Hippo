// Frame guard. GitHub Pages cannot send HTTP headers and a <meta> CSP cannot
// set `frame-ancestors`, so Hippo checks for itself that it is the top-level
// page. A page that another site frames could be driven by that site (clicks
// on top of the UI), so the app refuses to start there.

/** The two window references the check needs. Comparing them never touches a cross-origin frame's contents. */
export interface FrameWindowLike {
  readonly top: unknown
  readonly self: unknown
}

/** True when the page is inside another page's frame. Any error while checking counts as framed. */
export function isFramed(win: FrameWindowLike): boolean {
  try {
    return win.top !== win.self
  } catch {
    return true
  }
}

/** The text shown instead of the app. Plain sentences, no markup. */
export const FRAME_BLOCK_MESSAGE =
  'Hippo does not run inside another site, because that site could watch or steer what you do. Open Hippo in its own tab instead.'
export const FRAME_BLOCK_LINK_TEXT = 'Open Hippo in its own tab'

/** The link target: this page's own address, only when it is plain http(s). */
export function frameBreakoutUrl(href: string): string | undefined {
  try {
    const u = new URL(href)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined
  } catch {
    return undefined
  }
}

/**
 * Runs before React mounts. When framed, replaces the page body with a plain
 * message and one link that opens Hippo in its own tab, and returns `true`:
 * the caller must then start nothing else (no database, no relays).
 */
export function blockIfFramed(win: FrameWindowLike, doc: Document, href: string): boolean {
  if (!isFramed(win)) return false
  const wrap = doc.createElement('main')
  wrap.style.cssText = 'font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto 0;padding:0 1.5rem;color:#0f172a;background:#fff'
  const p = doc.createElement('p')
  p.textContent = FRAME_BLOCK_MESSAGE
  wrap.appendChild(p)
  const target = frameBreakoutUrl(href)
  if (target !== undefined) {
    const a = doc.createElement('a')
    a.textContent = FRAME_BLOCK_LINK_TEXT
    a.href = target
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.style.cssText = 'color:#1d4ed8;font-weight:600'
    wrap.appendChild(a)
  }
  doc.body.replaceChildren(wrap)
  return true
}
