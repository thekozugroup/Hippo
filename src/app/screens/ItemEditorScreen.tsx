import { useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { Archive, ArchiveRestore, Plus, Trash2 } from 'lucide-react'
import { useLocation } from 'wouter'
import {
  BottomSheet,
  Button,
  Chip,
  EmptyState,
  LinkButton,
  MoneyField,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
  TextArea,
  TextField,
  Thumb,
  TwoTone,
} from '../../ui/index.ts'
import {
  archiveItem,
  createCategory,
  createItem,
  deleteItem,
  fillEmptyFields,
  findFirstHttpUrl,
  getLinkPreviewEnabled,
  getPageLookupEnabled,
  getSettings,
  guessTitleFromUrl,
  IMPORTANCE_LEVELS,
  isHippoError,
  isKnownCurrency,
  LIMITS,
  lookupLinkPreview,
  markSeen,
  stripTrackingParams,
  mergeItemEdit,
  unarchiveItem,
  type DraftItem,
  type Importance,
  type Item,
  type ItemPatch,
  type Money,
} from '../../core/index.ts'
import { captureEpoch, clearCaptureDraft, peekCaptureDraft, subscribeCapture } from '../core/capture.ts'
import { useCore } from '../core/context.ts'
import { useCategories, useItem, useSharedLists } from '../core/data.ts'
import { useNotify } from '../core/notify.ts'
import { requestPersistentStorage } from '../core/storage.ts'
import { AppScreen } from '../layout/AppScreen.tsx'
import { CURRENCIES, IMPORTANCE_LABEL, moneyInputValue, parseMoneyInput, priceExample, safeUrl } from '../lib/format.ts'
import { clearFormDraft, readFormDraft, writeFormDraft } from '../lib/form-draft.ts'
import { isNativeApp, lookupOnDevice } from '../native/index.ts'
import { resyncItem, resyncLists } from '../lib/sync.ts'
import './ItemEditorScreen.css'

const CURRENCY_KEY = 'hippo:currency'

function defaultCurrency(): string {
  try {
    const c = localStorage.getItem(CURRENCY_KEY)
    if (c && isKnownCurrency(c)) return c
  } catch {
    // ignore
  }
  return 'USD'
}

function rememberCurrency(c: string): void {
  try {
    localStorage.setItem(CURRENCY_KEY, c)
  } catch {
    // ignore
  }
}

interface FormState {
  title: string
  url: string
  imageUrl: string
  price: string
  currency: string
  quantity: string
  importance: Importance
  notes: string
  categoryIds: string[]
  allowContributions: boolean
}

type Errors = Partial<Record<keyof FormState | 'form', string>>

function initialState(item: Item | null, draft: DraftItem | null): FormState {
  const currency = item?.price?.currency ?? draft?.price?.currency ?? defaultCurrency()
  return {
    title: item?.title ?? draft?.title ?? '',
    url: item?.url ?? draft?.url ?? '',
    imageUrl: item?.imageUrl ?? draft?.imageUrl ?? '',
    price: moneyInputValue(item?.price ?? draft?.price),
    currency,
    quantity: String(item?.quantity ?? 1),
    importance: item?.importance ?? 'want',
    notes: item?.notes ?? draft?.notes ?? '',
    categoryIds: item?.categoryIds ?? [],
    allowContributions: item?.allowContributions ?? false,
  }
}

function isWebAddress(s: string): boolean {
  return safeUrl(s) !== undefined
}

function validate(f: FormState): { errors: Errors; price: Money | null; quantity: number } {
  const errors: Errors = {}
  if (!f.title.trim()) errors.title = 'Give this wish a name.'
  if (f.url.trim() && !isWebAddress(f.url.trim())) errors.url = 'Use a web address that starts with https://'
  if (f.imageUrl.trim() && !isWebAddress(f.imageUrl.trim())) errors.imageUrl = 'Use an image address that starts with https://'
  const price = parseMoneyInput(f.price, f.currency)
  if (price === undefined) errors.price = `Enter a price like ${priceExample(f.currency)}, or leave it empty.`
  const quantity = Number(f.quantity)
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > LIMITS.quantity) errors.quantity = `Enter a whole number from 1 to ${LIMITS.quantity}.`
  if (f.allowContributions && !price) errors.allowContributions = 'Add a price so friends can see how much is still needed.'
  return { errors, price: price ?? null, quantity }
}

/** The form as an item patch (what saving would write), or null when it does not validate. */
function toPatch(f: FormState, categoryIds: readonly string[]): ItemPatch | null {
  const { errors, price, quantity } = validate(f)
  if (Object.keys(errors).length > 0) return null
  return {
    title: f.title.trim(),
    quantity,
    importance: f.importance,
    categoryIds: f.categoryIds.filter((id) => categoryIds.includes(id)),
    allowContributions: f.allowContributions,
    url: f.url.trim() || null,
    imageUrl: f.imageUrl.trim() || null,
    notes: f.notes.trim() || null,
    price,
  }
}

const FIELD_WORDS: Record<keyof ItemPatch, string> = {
  title: 'name',
  url: 'shop link',
  imageUrl: 'picture link',
  price: 'price',
  quantity: 'number wanted',
  importance: 'how much you want it',
  notes: 'notes',
  categoryIds: 'categories',
  allowContributions: 'chipping in',
}

function joinWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** What a saved draft holds: the form, the form as it was loaded (to tell what this tab changed), and whether the currency was picked by hand. */
interface ItemDraft {
  form: FormState
  base: FormState
  currencyPicked: boolean
}

function isFormState(v: unknown): v is FormState {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const str = (k: string) => typeof o[k] === 'string'
  return (
    ['title', 'url', 'imageUrl', 'price', 'currency', 'quantity', 'notes'].every(str) &&
    (IMPORTANCE_LEVELS as readonly unknown[]).includes(o.importance) &&
    Array.isArray(o.categoryIds) &&
    o.categoryIds.every((x) => typeof x === 'string') &&
    typeof o.allowContributions === 'boolean' &&
    isKnownCurrency(String(o.currency))
  )
}

function parseItemDraft(v: unknown): ItemDraft | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (!isFormState(o.form) || !isFormState(o.base) || typeof o.currencyPicked !== 'boolean') return null
  return { form: o.form, base: o.base, currencyPicked: o.currencyPicked }
}

function draftKeyFor(item: Item | null): string {
  return item ? `item:${item.id}` : 'item:new'
}

function focusFirstError(): void {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('.item-form [aria-invalid="true"], .item-form .field__error')?.focus()
  })
}

type LookupNote = { kind: 'pending' | 'done'; text: string } | { kind: 'off-hint' }
/** Where the latest lookup is, on the form as data-lookup (read by the Android emulator check). */
type LookupPhase = 'idle' | 'off' | 'pending' | 'filled' | 'nothing' | 'failed'

const OFF_HINT = 'Pictures come automatically when you add with the bookmarklet or Shortcut. You can also turn on Link lookup in Settings.'
const FAILURE_TEXT: Record<'rate-limited' | 'other', string> = {
  'rate-limited': 'The free lookup service has no lookups left for now. You can add the title and picture yourself.',
  other: 'Could not look up this link. You can add the title and picture yourself.',
}

/** Inside the Android app the page is read on the phone, and a price can come with it. */
const DEVICE_TEXT = {
  pending: 'Reading the shop page\u2026',
  nothing: 'No name, picture or price found on this page. You can add them yourself.',
  failed: 'Could not read this page. You can add the details yourself.',
} as const

/** Words for what a lookup filled in. */
function filledText(patch: { title?: string; imageUrl?: string; price?: Money }): string {
  const parts = [patch.title ? 'title' : '', patch.imageUrl ? 'picture' : '', patch.price ? 'price' : ''].filter(Boolean)
  if (parts.length === 0) return ''
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `Filled in the ${list}. Check it before saving.`
}

/**
 * Link lookup for the wish form. On the website it is the opt-in Microlink lookup; inside the
 * Android app the phone reads the shop page itself (on unless turned off in Settings), and an empty
 * price also counts as something to fill. `start` is called for a link the user just pasted or was
 * handed (never for one read from a saved wish), and only looks up when the setting is on
 * and the title or picture (or, in the app, the price) is still empty. The result fills empty fields only. A newer link, an
 * edit of the link field or leaving the screen cancels the lookup (its answer is dropped); nothing
 * is retried. With the setting off nothing is sent, and a pasted link without a picture gets one
 * quiet hint, once per device.
 */
function useLinkLookup(f: FormState, setF: Dispatch<SetStateAction<FormState>>, prefilled: boolean) {
  const core = useCore()
  const [note, setNote] = useState<LookupNote | undefined>()
  const [phase, setPhase] = useState<LookupPhase>('idle')
  const run = useRef<{ id: number; url: string | undefined; controller?: AbortController }>({ id: 0, url: undefined })
  // The answer may arrive after the person kept typing: merge into what the form holds then.
  const latest = useRef(f)
  useEffect(() => {
    latest.current = f
  })

  const cancel = () => {
    run.current.controller?.abort()
    run.current = { id: run.current.id + 1, url: undefined }
    setNote(undefined)
    setPhase('idle')
  }

  const onDevice = isNativeApp()
  const start = (url: string, now: FormState, pasted: boolean) => {
    const titleBlank = !now.title.trim() || now.title === guessTitleFromUrl(url)
    if (!titleBlank && now.imageUrl.trim() && (!onDevice || now.price.trim())) return
    if (run.current.url === url) return // one lookup per link, never a retry
    const id = run.current.id + 1
    run.current.controller?.abort()
    const controller = new AbortController()
    run.current = { id, url, controller }
    setNote(undefined)
    void (async () => {
      const on = onDevice ? await getPageLookupEnabled(core.db) : await getLinkPreviewEnabled(core.db)
      if (run.current.id !== id) return
      // Turned off in the app's Settings: nothing is fetched and nothing is said.
      if (!on) setPhase('off')
      if (!on && onDevice) return
      if (!on) {
        if (pasted && !now.imageUrl.trim()) {
          const seen = await getSettings(core.db).then((st) => st.seen.linkPreviewHint !== undefined, () => true)
          if (run.current.id !== id || seen) return
          setNote({ kind: 'off-hint' })
          void markSeen(core.db, 'linkPreviewHint', core.now()).catch(() => undefined)
        }
        return
      }
      setNote({ kind: 'pending', text: onDevice ? DEVICE_TEXT.pending : 'Looking up the title and picture\u2026' })
      setPhase('pending')
      const result = onDevice ? await lookupOnDevice(url, { db: core.db, signal: controller.signal }) : await lookupLinkPreview(url, { db: core.db, signal: controller.signal })
      if (run.current.id !== id || result.kind === 'cancelled') return
      setPhase(result.kind === 'found' ? 'filled' : result.kind === 'nothing-found' ? 'nothing' : result.kind === 'disabled' ? 'off' : 'failed')
      if (result.kind === 'found') {
        const prev = latest.current
        const typedPrice = parseMoneyInput(prev.price, prev.currency)
        const patch = fillEmptyFields(
          {
            title: prev.title === guessTitleFromUrl(url) ? '' : prev.title,
            imageUrl: prev.imageUrl.trim(),
            price: prev.price.trim() ? (typedPrice ?? { amount: 1, currency: prev.currency }) : undefined,
          },
          result.patch,
        )
        setF((cur) => ({
          ...cur,
          ...(patch.title ? { title: patch.title } : {}),
          ...(patch.imageUrl ? { imageUrl: patch.imageUrl } : {}),
          ...(patch.price ? { price: moneyInputValue(patch.price), currency: patch.price.currency } : {}),
        }))
        const filled = filledText(patch)
        setNote(filled ? { kind: 'done', text: filled } : undefined)
      } else if (result.kind === 'nothing-found') {
        setNote({ kind: 'done', text: onDevice ? DEVICE_TEXT.nothing : 'No title or picture found for this link. You can add them yourself.' })
      } else if (result.kind === 'failed') {
        setNote({ kind: 'done', text: onDevice ? DEVICE_TEXT.failed : FAILURE_TEXT[result.reason === 'rate-limited' ? 'rate-limited' : 'other'] })
      } else {
        setNote(undefined)
      }
    })()
  }

  // A link handed over by the share target or a deep link is looked up once, on arrival.
  useEffect(() => {
    if (prefilled) start(f.url, f, false)
    return () => {
      run.current.controller?.abort()
      run.current = { id: run.current.id + 1, url: undefined }
    }
    // Once per mount: later changes to the form never start a lookup by themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hint = note?.kind === 'off-hint' ? OFF_HINT : note?.text
  return { start, cancel, hint, phase }
}

function ItemForm({ item, draft }: { item: Item | null; draft: DraftItem | null }) {
  const core = useCore()
  const notify = useNotify()
  const [, navigate] = useLocation()
  const categories = useCategories() ?? []
  const lists = useSharedLists() ?? []
  const draftKey = draftKeyFor(item)
  // A link handed over by the share sheet or a deep link starts a fresh form; otherwise an unsaved
  // draft from earlier in this tab comes back.
  const [start] = useState(() => {
    const saved = draft && !item ? null : parseItemDraft(readFormDraft(draftKey))
    if (draft && !item) clearFormDraft(draftKey)
    const loaded = initialState(item, draft)
    return saved ? { form: saved.form, base: saved.base, currencyPicked: saved.currencyPicked, restored: true } : { form: loaded, base: loaded, currencyPicked: false, restored: false }
  })
  const [f, setF] = useState<FormState>(start.form)
  const [base, setBase] = useState<FormState>(start.base)
  const [currencyPicked, setCurrencyPicked] = useState(start.currencyPicked)
  const [restored, setRestored] = useState(start.restored)
  const saved = useRef(false)
  // Unsaved typing is kept for this tab only (sessionStorage), so Back or a reload does not lose it.
  useEffect(() => {
    if (saved.current) return
    if (JSON.stringify(f) === JSON.stringify(base)) clearFormDraft(draftKey)
    else writeFormDraft(draftKey, { form: f, base, currencyPicked } satisfies ItemDraft)
  }, [f, base, currencyPicked, draftKey])
  const startOver = () => {
    const fresh = initialState(item, null)
    clearFormDraft(draftKey)
    setF(fresh)
    setBase(fresh)
    setCurrencyPicked(false)
    setRestored(false)
    setErrors({})
  }
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [newCatError, setNewCatError] = useState<string | undefined>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState<'archive' | 'delete' | null>(null)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF((prev) => ({ ...prev, [key]: value }))
  const onLists = item ? lists.filter((l) => l.itemIds.includes(item.id)) : []
  const lookup = useLinkLookup(f, setF, !item && Boolean(draft?.url))
  const startLookup = lookup.start

  /** FR-7: a pasted shop link fills the address and suggests a name. */
  const takeUrl = (text: string, pasted = false) => {
    const found = findFirstHttpUrl(text)
    if (!found) return false
    const url = stripTrackingParams(found)
    setF((prev) => ({ ...prev, url, title: prev.title.trim() ? prev.title : guessTitleFromUrl(url) }))
    startLookup(url, f, pasted)
    return true
  }

  const onPasteUrl = (e: ClipboardEvent<HTMLInputElement>) => {
    if (takeUrl(e.clipboardData.getData('text'), true)) e.preventDefault()
  }

  const [addingCat, setAddingCat] = useState(false)
  const addCategory = async () => {
    if (addingCat) return
    const name = newCat.trim()
    if (!name) {
      setNewCatError('Type a name first.')
      return
    }
    const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase())
    setAddingCat(true)
    try {
      const cat = existing ?? (await createCategory(core.db, name))
      setF((prev) => ({ ...prev, categoryIds: prev.categoryIds.includes(cat.id) ? prev.categoryIds : [...prev.categoryIds, cat.id] }))
      setNewCat('')
      setNewCatError(undefined)
      notify(`${cat.name} added and selected`)
    } catch (e) {
      setNewCatError(isHippoError(e, 'invalid-input') ? `Use up to ${LIMITS.categoryName} characters.` : 'Could not add this category.')
    } finally {
      setAddingCat(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    const { errors: errs, price, quantity } = validate(f)
    setErrors(errs)
    if (Object.keys(errs).length > 0) {
      notify(`Please check ${Object.keys(errs).length === 1 ? 'one field' : `${Object.keys(errs).length} fields`}.`)
      focusFirstError()
      return
    }
    setSaving(true)
    const catIds = categories.map((c) => c.id)
    const fields = {
      title: f.title.trim(),
      quantity,
      importance: f.importance,
      categoryIds: f.categoryIds.filter((id) => catIds.includes(id)),
      allowContributions: f.allowContributions,
    }
    try {
      // The currency becomes the default for new wishes only when the person picked it in this form.
      if (price && currencyPicked) rememberCurrency(price.currency)
      if (item) {
        // Only what was changed in this form is written, onto the wish as it is stored now.
        const full = toPatch(f, catIds) ?? {}
        const loaded = toPatch(base, catIds)
        const patch: ItemPatch = {}
        const expected: ItemPatch = {}
        for (const k of Object.keys(full) as (keyof ItemPatch)[]) {
          if (loaded && JSON.stringify(full[k] ?? null) === JSON.stringify(loaded[k] ?? null)) continue
          Object.assign(patch, { [k]: full[k] })
          if (loaded) Object.assign(expected, { [k]: loaded[k] })
        }
        const r = await mergeItemEdit(core.db, item.id, patch, expected, core.now())
        saved.current = true
        clearFormDraft(draftKey)
        if (Object.keys(patch).length > 0) resyncItem(core, item.id, notify)
        notify(
          r.changedElsewhere.length > 0
            ? `Changes saved. This wish was also changed somewhere else; your ${joinWords(r.changedElsewhere.map((k) => FIELD_WORDS[k]))} replaced that.`
            : 'Changes saved',
        )
      } else {
        await createItem(core.db, {
          ...fields,
          ...(f.url.trim() ? { url: f.url.trim() } : {}),
          ...(f.imageUrl.trim() ? { imageUrl: f.imageUrl.trim() } : {}),
          ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
          ...(price ? { price } : {}),
        }, core.now())
        saved.current = true
        clearFormDraft(draftKey)
        clearCaptureDraft()
        // Ask the browser to keep Hippo's data now that there is something worth keeping (never awaited).
        void requestPersistentStorage()
        notify(`Added ${fields.title}`)
      }
      navigate('/wishlist')
    } catch (err) {
      setSaving(false)
      setErrors({ form: isHippoError(err, 'invalid-input') ? `Something is too long or not valid: ${err.message}` : 'Could not save. Please try again.' })
      focusFirstError()
    }
  }

  const toggleArchive = async () => {
    if (!item || busy) return
    setBusy('archive')
    try {
      if (item.archivedAt === undefined) {
        await archiveItem(core.db, item.id, core.now())
        notify('Archived. It stays in your wishlist but is left off shared lists.')
      } else {
        await unarchiveItem(core.db, item.id, core.now())
        notify('Back in your wishlist')
      }
      resyncItem(core, item.id, notify)
    } catch {
      notify(item.archivedAt === undefined ? 'Could not archive this wish. Please try again.' : 'Could not unarchive this wish. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!item || busy) return
    setBusy('delete')
    try {
      const changed = await deleteItem(core.db, item.id, core.now())
      saved.current = true
      clearFormDraft(draftKey)
      resyncLists(core, changed, notify)
      setConfirmDelete(false)
      notify(`Deleted ${item.title}`)
      navigate('/wishlist')
    } catch {
      setBusy(null)
      notify('Could not delete this wish. Please try again.')
    }
  }

  const err = (k: keyof Errors) => (errors[k] ? { error: errors[k] } : {})

  return (
    <form className="item-form app-stack app-stack--loose" data-lookup={lookup.phase} onSubmit={(e) => void submit(e)} noValidate>
      {restored ? (
        <div className="item-form__restored" role="status">
          <p className="app-note">Your unsaved changes are back.</p>
          <Button variant="ghost" size="md" onClick={startOver}>
            Start over
          </Button>
        </div>
      ) : null}
      {draft && !item ? (
        <p className="app-banner" role="note">
          We filled in what the page shared. Check the details before saving.
        </p>
      ) : null}
      {errors.form ? (
        <p className="field__error" role="alert" tabIndex={-1}>
          {errors.form}
        </p>
      ) : null}

      <div className="app-stack">
        <TextField
          label="Shop link"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://"
          hint={lookup.hint ?? 'Paste a link and we will suggest a name.'}
          value={f.url}
          maxLength={LIMITS.url}
          onChange={(e) => {
            lookup.cancel()
            set('url', e.target.value)
          }}
          onPaste={onPasteUrl}
          onBlur={() => {
            const typed = f.url.trim()
            if (!typed) return
            if (!f.title.trim()) takeUrl(f.url)
            else if (typed !== (item?.url ?? draft?.url ?? '')) startLookup(typed, f, false)
          }}
          {...err('url')}
        />
        <span className="sr-only" role="status">
          {lookup.hint ?? ''}
        </span>
        <TextField
          label="Name"
          required
          aria-required="true"
          value={f.title}
          maxLength={LIMITS.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="What would you love?"
          {...err('title')}
        />
      </div>

      <div className="item-form__price">
        <MoneyField
          label="Price"
          currency={f.currency}
          value={f.price}
          placeholder="Optional"
          onChange={(e) => set('price', e.target.value)}
          {...err('price')}
        />
        <Select
          label="Currency"
          value={f.currency}
          onChange={(e) => {
            set('currency', e.target.value)
            setCurrencyPicked(true)
          }}
        >
          {[...new Set([f.currency, ...CURRENCIES])].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>

      <TextField
        label="How many?"
        type="number"
        inputMode="numeric"
        min={1}
        max={LIMITS.quantity}
        value={f.quantity}
        onChange={(e) => set('quantity', e.target.value)}
        hint="For things you would like more than one of."
        {...err('quantity')}
      />

      <div className="app-stack app-stack--tight">
        <p className="field__label" aria-hidden="true">
          How much do you want it?
        </p>
        <SegmentedControl<Importance>
        label="How much do you want it?"
        value={f.importance}
        onChange={(v) => set('importance', v)}
        options={IMPORTANCE_LEVELS.map((l) => ({ value: l, label: IMPORTANCE_LABEL[l] }))}
        />
      </div>

      <fieldset className="item-form__group">
        <legend className="field__label">Categories</legend>
        {categories.length > 0 ? (
          <div className="app-row">
            {categories.map((c) => {
              const on = f.categoryIds.includes(c.id)
              return (
                <Chip
                  key={c.id}
                  selected={on}
                  onClick={() => set('categoryIds', on ? f.categoryIds.filter((x) => x !== c.id) : [...f.categoryIds, c.id])}
                >
                  {c.emoji ? `${c.emoji} ${c.name}` : c.name}
                </Chip>
              )
            })}
          </div>
        ) : null}
        <div className="item-form__newcat">
          <TextField
            label="New category"
            value={newCat}
            maxLength={LIMITS.categoryName}
            placeholder="Kitchen"
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void addCategory()
              }
            }}
            {...(newCatError ? { error: newCatError } : {})}
          />
          <Button variant="secondary" size="md" icon={<Plus />} loading={addingCat} onClick={() => void addCategory()}>
            Add category
          </Button>
        </div>
      </fieldset>

      <div className="app-stack">
        <Switch
          label="Let friends chip in"
          description="Friends can chip in part of the price instead of buying the whole thing."
          checked={f.allowContributions}
          onChange={(e) => set('allowContributions', e.target.checked)}
          aria-invalid={errors.allowContributions ? true : undefined}
          aria-describedby={errors.allowContributions ? 'contrib-error' : undefined}
        />
        {errors.allowContributions ? (
          <p className="field__error" id="contrib-error">
            {errors.allowContributions}
          </p>
        ) : null}
      </div>

      <TextArea
        label="Notes"
        value={f.notes}
        maxLength={LIMITS.notes}
        placeholder="Size, colour, where to find it"
        hint="Shown to friends unless you hide notes on a list."
        onChange={(e) => set('notes', e.target.value)}
      />

      <div className="item-form__image">
        <TextField
          label="Picture link"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://"
          value={f.imageUrl}
          maxLength={LIMITS.url}
          onChange={(e) => set('imageUrl', e.target.value)}
          hint="Optional. Shown instead of the letter tile."
          {...err('imageUrl')}
        />
        <Thumb name={f.title || '?'} src={safeUrl(f.imageUrl.trim())} size="lg" />
      </div>

      {onLists.length > 0 ? (
        <p className="app-note">
          On {onLists.length === 1 ? 'your list' : 'your lists'} {onLists.map((l) => l.name).join(', ')}. Changes are shared automatically.
        </p>
      ) : null}

      <div className="item-form__actions">
        <Button type="submit" variant="primary" fullWidth loading={saving}>
          {item ? 'Save changes' : 'Add to wishlist'}
        </Button>
        {item ? (
          <div className="app-row app-row--fill">
            <Button
              variant="secondary"
              size="md"
              fullWidth
              icon={item.archivedAt === undefined ? <Archive /> : <ArchiveRestore />}
              loading={busy === 'archive'}
              disabled={busy === 'delete'}
              onClick={() => void toggleArchive()}
            >
              {item.archivedAt === undefined ? 'Archive wish' : 'Unarchive wish'}
            </Button>
            <Button variant="danger" size="md" fullWidth icon={<Trash2 />} disabled={busy !== null} onClick={() => setConfirmDelete(true)}>
              Delete wish
            </Button>
          </div>
        ) : null}
      </div>

      {item ? (
        <BottomSheet
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Delete this wish?"
          description={`${item.title} will be removed from your wishlist and from any shared list. This cannot be undone.`}
        >
          <div className="app-stack">
            <Button variant="danger" fullWidth loading={busy === 'delete'} onClick={() => void remove()}>
              Delete wish
            </Button>
            <Button variant="secondary" fullWidth onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
          </div>
        </BottomSheet>
      ) : null}
    </form>
  )
}

/** A share that arrives while Add a wish is open (Android app) replaces the form with a fresh one. */
export function ItemEditorScreen({ id }: { id?: string }) {
  const epoch = useSyncExternalStore(subscribeCapture, captureEpoch, captureEpoch)
  return <ItemEditor key={id === undefined ? `new-${epoch}` : id} {...(id === undefined ? {} : { id })} />
}

function ItemEditor({ id }: { id?: string }) {
  const item = useItem(id)
  const [draft] = useState<DraftItem | null>(() => (id ? null : peekCaptureDraft()))

  // A captured draft is used once; leaving the form drops it.
  useEffect(() => {
    if (!id) return () => clearCaptureDraft()
    return undefined
  }, [id])

  const isNew = id === undefined
  const title = isNew ? 'Add a wish' : item ? 'Edit wish' : 'Wish'
  return (
    <AppScreen title={title} back={isNew ? '#/' : '#/wishlist'} backLabel={isNew ? 'Back to home' : 'Back to wishlist'} busy={!isNew && item === undefined}>
      {isNew ? (
        <ItemForm item={null} draft={draft} />
      ) : item === undefined ? (
        <div className="app-stack">
          <Skeleton height={56} shape="tile" />
          <Skeleton height={56} shape="tile" />
        </div>
      ) : item === null ? (
        <EmptyState
          title={<TwoTone muted="Not found." bright="This wish is not on this device." />}
          description="It may have been deleted."
          action={
            <LinkButton href="#/wishlist" variant="secondary">
              Go to wishlist
            </LinkButton>
          }
        />
      ) : (
        <ItemForm key={item.id} item={item} draft={null} />
      )}
    </AppScreen>
  )
}

export default ItemEditorScreen
