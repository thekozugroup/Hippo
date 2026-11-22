// Small hand-written validation primitives. Each reader throws SchemaError
// with a dotted path so import errors can say where the problem is.

export class SchemaError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'SchemaError'
    this.path = path
  }
}

export type Obj = Record<string, unknown>

export function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readObject(value: unknown, path: string): Obj {
  if (!isObject(value)) throw new SchemaError(path, 'expected an object')
  return value
}

/** Length in Unicode code points, so an emoji counts as one character. */
export function codePointLength(s: string): number {
  let n = 0
  for (const _ of s) n++
  return n
}

export function readString(value: unknown, path: string, max: number, min = 0): string {
  if (typeof value !== 'string') throw new SchemaError(path, 'expected a string')
  // Cheap pre-check before iterating code points on a possibly huge string.
  if (value.length > max * 2) throw new SchemaError(path, `longer than ${max}`)
  const len = codePointLength(value)
  if (len > max) throw new SchemaError(path, `longer than ${max}`)
  if (len < min) throw new SchemaError(path, `shorter than ${min}`)
  return value
}

export function readOptionalString(
  value: unknown,
  path: string,
  max: number,
): string | undefined {
  if (value === undefined) return undefined
  return readString(value, path, max)
}

export function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new SchemaError(path, 'expected a boolean')
  return value
}

export function readInt(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new SchemaError(path, 'expected an integer')
  }
  if (value < min || value > max) throw new SchemaError(path, `out of range ${min}..${max}`)
  return value
}

export function readOptionalInt(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined
  return readInt(value, path, min, max)
}

export function readTimestamp(value: unknown, path: string): number {
  return readInt(value, path, 0, Number.MAX_SAFE_INTEGER)
}

export function readEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new SchemaError(path, `expected one of ${allowed.join(', ')}`)
  }
  return value as T
}

export function readArray(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new SchemaError(path, 'expected an array')
  if (value.length > max) throw new SchemaError(path, `more than ${max} entries`)
  return value
}

const HEX_RE = /^[0-9a-f]+$/

export function isHex(value: unknown, bytes: number): value is string {
  return typeof value === 'string' && value.length === bytes * 2 && HEX_RE.test(value)
}

export function readHex(value: unknown, path: string, bytes: number): string {
  if (!isHex(value, bytes)) throw new SchemaError(path, `expected ${bytes} bytes of lowercase hex`)
  return value
}

export function readId(value: unknown, path: string): string {
  return readHex(value, path, 16)
}

export function readIdList(value: unknown, path: string, max: number): string[] {
  const arr = readArray(value, path, max)
  const out: string[] = []
  const seen = new Set<string>()
  arr.forEach((v, i) => {
    const id = readId(v, `${path}[${i}]`)
    if (seen.has(id)) throw new SchemaError(`${path}[${i}]`, 'duplicate id')
    seen.add(id)
    out.push(id)
  })
  return out
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(value: string): boolean {
  const m = DATE_RE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

export function readOptionalDate(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !isIsoDate(value)) {
    throw new SchemaError(path, 'expected a YYYY-MM-DD date')
  }
  return value
}

/** Only http(s) URLs may be rendered as links or images (PROTOCOL.md section 5). */
export function isSafeHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Reads a URL field; anything that is not http(s) is dropped rather than rejected. */
export function readOptionalHttpUrl(value: unknown, path: string, max: number): string | undefined {
  const s = readOptionalString(value, path, max)
  if (s === undefined || s === '') return undefined
  return isSafeHttpUrl(s) ? s : undefined
}
