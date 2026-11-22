import { describe, expect, it } from 'vitest'
import { blockIfFramed, FRAME_BLOCK_LINK_TEXT, FRAME_BLOCK_MESSAGE, frameBreakoutUrl, isFramed } from './frame-guard.ts'

interface FrameBlockElement {
  textContent: string | null
  href?: string
  target?: string
  rel?: string
  style: { cssText: string }
  appendChild(child: FrameBlockElement): unknown
  replaceChildren(...nodes: FrameBlockElement[]): void
}

function fakeElement(tag: string): FrameBlockElement & { tag: string; children: FrameBlockElement[] } {
  const el = {
    tag,
    children: [] as FrameBlockElement[],
    textContent: null as string | null,
    style: { cssText: '' },
    appendChild(c: FrameBlockElement) {
      el.children.push(c)
    },
    replaceChildren(...nodes: FrameBlockElement[]) {
      el.children = nodes
    },
  }
  return el
}

function fakeDoc(): { doc: Document; body: ReturnType<typeof fakeElement> } {
  const body = fakeElement('body')
  return { doc: { createElement: fakeElement, body } as unknown as Document, body }
}

describe('isFramed', () => {
  it('is false when top is self', () => {
    const w = {}
    expect(isFramed({ top: w, self: w })).toBe(false)
  })
  it('is true when top differs', () => {
    expect(isFramed({ top: {}, self: {} })).toBe(true)
  })
  it('treats an access error as framed', () => {
    const w = {
      get top(): unknown {
        throw new Error('SecurityError')
      },
      self: {},
    }
    expect(isFramed(w)).toBe(true)
  })
})

describe('frameBreakoutUrl', () => {
  it.each([
    ['https://me.github.io/hippo/#/l/abc', 'https://me.github.io/hippo/#/l/abc'],
    ['javascript:alert(1)', undefined],
    ['data:text/html,x', undefined],
    ['not a url', undefined],
  ])('%s', (href, expected) => {
    expect(frameBreakoutUrl(href)).toBe(expected)
  })
})

describe('blockIfFramed', () => {
  it('does nothing and returns false when not framed', () => {
    const w = {}
    const { doc, body } = fakeDoc()
    expect(blockIfFramed({ top: w, self: w }, doc, 'https://x.example/')).toBe(false)
    expect(body.children).toHaveLength(0)
  })

  it('replaces the page with a message and a link that opens a new tab', () => {
    const { doc, body } = fakeDoc()
    expect(blockIfFramed({ top: {}, self: {} }, doc, 'https://x.example/hippo/')).toBe(true)
    const main = body.children[0] as ReturnType<typeof fakeElement>
    expect(main.tag).toBe('main')
    const [p, a] = main.children as ReturnType<typeof fakeElement>[]
    expect(p?.textContent).toBe(FRAME_BLOCK_MESSAGE)
    expect(a?.tag).toBe('a')
    expect(a?.textContent).toBe(FRAME_BLOCK_LINK_TEXT)
    expect(a?.href).toBe('https://x.example/hippo/')
    expect(a?.target).toBe('_blank')
    expect(a?.rel).toBe('noopener noreferrer')
  })

  it('shows no link when the address is not http(s)', () => {
    const { doc, body } = fakeDoc()
    expect(blockIfFramed({ top: {}, self: {} }, doc, 'javascript:1')).toBe(true)
    const main = body.children[0] as ReturnType<typeof fakeElement>
    expect(main.children).toHaveLength(1)
  })

  it('works with a real jsdom document', () => {
    document.body.innerHTML = '<div id="root"><button>secret</button></div>'
    expect(blockIfFramed({ top: {}, self: {} }, document, 'https://x.example/')).toBe(true)
    expect(document.querySelector('button')).toBeNull()
    expect(document.querySelector('a')?.getAttribute('href')).toBe('https://x.example/')
  })
})
