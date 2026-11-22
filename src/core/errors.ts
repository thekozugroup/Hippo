export type HippoErrorCode =
  | 'invalid-link'
  | 'own-list'
  | 'not-found'
  | 'invalid-input'
  | 'invalid-import'
  | 'unsupported-version'
  | 'not-published'
  | 'list-unpublished'
  | 'item-unavailable'
  | 'contributions-disabled'
  | 'not-my-claim'

/** Typed error for every expected failure; the UI switches on `code`. */
export class HippoError extends Error {
  readonly code: HippoErrorCode
  constructor(code: HippoErrorCode, message: string) {
    super(message)
    this.name = 'HippoError'
    this.code = code
  }
}

export function isHippoError(e: unknown, code?: HippoErrorCode): e is HippoError {
  return e instanceof HippoError && (code === undefined || e.code === code)
}
