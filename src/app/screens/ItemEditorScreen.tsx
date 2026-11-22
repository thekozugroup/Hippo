import { useEffect, useState, type ClipboardEvent, type FormEvent } from 'react'
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
  findFirstHttpUrl,
  guessTitleFromUrl,
  IMPORTANCE_LEVELS,
  isHippoError,
  LIMITS,
  stripTrackingParams,
  unarchiveItem,
  updateItem,
  type DraftItem,
  type Importance,
  type Item,
  type ItemPatch,
  type Money,
} from '../../core/index.ts'
import { clearCaptureDraft, peekCaptureDraft } from '../core/capture.ts'
import { useCore } from '../core/context.ts'
import { useCategories, useItem, useSharedLists } from '../core/data.ts'
import { useNotify } from '../core/notify.ts'
import { requestPersistentStorage } from '../core/storage.ts'
import { AppScreen } from '../layout/AppScreen.tsx'
import { CURRENCIES, IMPORTANCE_LABEL, moneyInputValue, parseMoneyInput, safeUrl } from '../lib/format.ts'
import { resyncItem, resyncLists } from '../lib/sync.ts'
import './ItemEditorScreen.css'

const CURRENCY_KEY = 'hippo:currency'

function defaultCurrency(): string {
  try {
    const c = localStorage.getItem(CURRENCY_KEY)
    if (c && /^[A-Z]{3}$/.test(c)) return c
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
    notes: item?.notes ?? '',
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
  if (price === undefined) errors.price = 'Enter a price like 24.99, or leave it empty.'
  const quantity = Number(f.quantity)
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > LIMITS.quantity) errors.quantity = `Enter a whole number from 1 to ${LIMITS.quantity}.`
  if (f.allowContributions && !price) errors.allowContributions = 'Add a price so friends can see how much is still needed.'
  return { errors, price: price ?? null, quantity }
}

function focusFirstError(): void {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('.item-form [aria-invalid="true"], .item-form .field__error')?.focus()
  })
}

function ItemForm({ item, draft }: { item: Item | null; draft: DraftItem | null }) {
  const core = useCore()
  const notify = useNotify()
  const [, navigate] = useLocation()
  const categories = useCategories() ?? []
  const lists = useSharedLists() ?? []
  const [f, setF] = useState<FormState>(() => initialState(item, draft))
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [newCatError, setNewCatError] = useState<string | undefined>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState<'archive' | 'delete' | null>(null)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF((prev) => ({ ...prev, [key]: value }))
  const onLists = item ? lists.filter((l) => l.itemIds.includes(item.id)) : []

  /** FR-7: a pasted shop link fills the address and suggests a name. */
  const takeUrl = (text: string) => {
    const found = findFirstHttpUrl(text)
    if (!found) return false
    const url = stripTrackingParams(found)
    setF((prev) => ({ ...prev, url, title: prev.title.trim() ? prev.title : guessTitleFromUrl(url) }))
    return true
  }

  const onPasteUrl = (e: ClipboardEvent<HTMLInputElement>) => {
    if (takeUrl(e.clipboardData.getData('text'))) e.preventDefault()
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
    const fields = {
      title: f.title.trim(),
      quantity,
      importance: f.importance,
      categoryIds: f.categoryIds.filter((id) => categories.some((c) => c.id === id)),
      allowContributions: f.allowContributions,
    }
    try {
      if (price) rememberCurrency(price.currency)
      if (item) {
        const patch: ItemPatch = {
          ...fields,
          url: f.url.trim() || null,
          imageUrl: f.imageUrl.trim() || null,
          notes: f.notes.trim() || null,
          price,
        }
        await updateItem(core.db, item.id, patch)
        resyncItem(core, item.id, notify)
        notify('Changes saved')
      } else {
        await createItem(core.db, {
          ...fields,
          ...(f.url.trim() ? { url: f.url.trim() } : {}),
          ...(f.imageUrl.trim() ? { imageUrl: f.imageUrl.trim() } : {}),
          ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
          ...(price ? { price } : {}),
        })
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
        await archiveItem(core.db, item.id)
        notify('Archived. It stays in your wishlist but is left off shared lists.')
      } else {
        await unarchiveItem(core.db, item.id)
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
      const changed = await deleteItem(core.db, item.id)
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
    <form className="item-form app-stack app-stack--loose" onSubmit={(e) => void submit(e)} noValidate>
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
          hint="Paste a link and we will suggest a name."
          value={f.url}
          maxLength={LIMITS.url}
          onChange={(e) => set('url', e.target.value)}
          onPaste={onPasteUrl}
          onBlur={() => {
            if (f.url.trim() && !f.title.trim()) takeUrl(f.url)
          }}
          {...err('url')}
        />
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
        <Select label="Currency" value={f.currency} onChange={(e) => set('currency', e.target.value)}>
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
        ) : (
          <p className="app-note">No categories yet. Add one below.</p>
        )}
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
            Add
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
          hint="Optional. A link to a product photo."
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
          <div className="app-row app-row--nowrap">
            <Button
              variant="secondary"
              size="md"
              fullWidth
              icon={item.archivedAt === undefined ? <Archive /> : <ArchiveRestore />}
              loading={busy === 'archive'}
              disabled={busy === 'delete'}
              onClick={() => void toggleArchive()}
            >
              {item.archivedAt === undefined ? 'Archive' : 'Unarchive'}
            </Button>
            <Button variant="danger" size="md" fullWidth icon={<Trash2 />} disabled={busy !== null} onClick={() => setConfirmDelete(true)}>
              Delete
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
              Delete
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

export function ItemEditorScreen({ id }: { id?: string }) {
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
