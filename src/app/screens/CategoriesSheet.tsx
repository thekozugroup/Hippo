import { useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { BottomSheet, Button, IconButton, TextField } from '../../ui/index.ts'
import {
  createCategory,
  deleteCategory,
  isHippoError,
  LIMITS,
  reorderCategories,
  updateCategory,
  type Category,
} from '../../core/index.ts'
import { useCore } from '../core/context.ts'
import { useCategories } from '../core/data.ts'
import { useNotify } from '../core/notify.ts'
import './CategoriesSheet.css'

function CategoryRow({ category, index, total, all }: { category: Category; index: number; total: number; all: Category[] }) {
  const { db } = useCore()
  const notify = useNotify()
  const [name, setName] = useState(category.name)
  const [error, setError] = useState<string | undefined>()

  const save = async () => {
    const trimmed = name.trim()
    if (trimmed === category.name) return
    if (!trimmed) {
      setError('A category needs a name.')
      return
    }
    try {
      await updateCategory(db, category.id, { name: trimmed })
      setError(undefined)
      notify(`Renamed to ${trimmed}`)
    } catch (e) {
      setError(isHippoError(e, 'invalid-input') ? `Use up to ${LIMITS.categoryName} characters.` : 'Could not rename this category.')
    }
  }

  const move = async (delta: -1 | 1) => {
    const ids = all.map((c) => c.id)
    const j = index + delta
    const other = ids[j]
    if (other === undefined) return
    ids[j] = category.id
    ids[index] = other
    await reorderCategories(db, ids)
    notify(`${category.name} moved ${delta < 0 ? 'up' : 'down'}`)
  }

  const remove = async () => {
    await deleteCategory(db, category.id)
    notify(`Deleted ${category.name}. Items in it were kept.`)
  }

  return (
    <li className="cat-row">
      <TextField
        label={`Category ${index + 1}`}
        value={name}
        maxLength={LIMITS.categoryName}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void save()
          }
        }}
        {...(error ? { error } : {})}
      />
      <div className="cat-row__actions">
        <IconButton aria-label={`Move ${category.name} up`} icon={<ArrowUp />} disabled={index === 0} onClick={() => void move(-1)} />
        <IconButton aria-label={`Move ${category.name} down`} icon={<ArrowDown />} disabled={index === total - 1} onClick={() => void move(1)} />
        <IconButton aria-label={`Delete ${category.name}`} icon={<Trash2 />} onClick={() => void remove()} />
      </div>
    </li>
  )
}

/** FR-3: create, rename, reorder and delete categories. */
export function CategoriesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db } = useCore()
  const notify = useNotify()
  const categories = useCategories() ?? []
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>()

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Type a name for the new category.')
      return
    }
    if (categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('You already have a category with this name.')
      return
    }
    try {
      await createCategory(db, trimmed)
      setName('')
      setError(undefined)
      notify(`Added category ${trimmed}`)
    } catch (err) {
      setError(isHippoError(err, 'invalid-input') ? `Use up to ${LIMITS.categoryName} characters.` : 'Could not add this category.')
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Categories" description="Group your wishes. Deleting a category keeps its items.">
      <form className="cat-add" onSubmit={(e) => void add(e)} noValidate>
        <TextField
          label="New category"
          placeholder="Books, Kitchen, Outdoors"
          value={name}
          maxLength={LIMITS.categoryName}
          onChange={(e) => setName(e.target.value)}
          {...(error ? { error } : {})}
        />
        <Button type="submit" variant="secondary" size="md">
          Add
        </Button>
      </form>
      {categories.length === 0 ? (
        <p className="app-note">No categories yet.</p>
      ) : (
        <ul className="cat-list">
          {categories.map((c, i) => (
            <CategoryRow key={c.id} category={c} index={i} total={categories.length} all={categories} />
          ))}
        </ul>
      )}
    </BottomSheet>
  )
}
