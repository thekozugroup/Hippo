import { useState } from 'react'
import { Plus, Tags } from 'lucide-react'
import {
  Button,
  Chip,
  EmptyState,
  IconLink,
  ImportanceMark,
  LinkButton,
  List,
  ListRow,
  MoneyText,
  Select,
  Skeleton,
  Thumb,
  TwoTone,
} from '../../ui/index.ts'
import { filterAndSortItems, IMPORTANCE_LEVELS, type Importance, type ItemSort } from '../../core/index.ts'
import { useCategories, useItems } from '../core/data.ts'
import { AppScreen } from '../layout/AppScreen.tsx'
import { IMPORTANCE_LABEL, importanceLevel, safeUrl } from '../lib/format.ts'
import { CategoriesSheet } from './CategoriesSheet.tsx'
import './WishlistScreen.css'

const SORTS: ReadonlyArray<{ value: ItemSort; label: string }> = [
  { value: 'importance', label: 'Most wanted first' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
]

const IMPORTANCE_ORDER: readonly Importance[] = [...IMPORTANCE_LEVELS].reverse()

function isSort(v: string): v is ItemSort {
  return SORTS.some((s) => s.value === v)
}

export function WishlistScreen() {
  const [showArchived, setShowArchived] = useState(false)
  const allItems = useItems(true)
  const categories = useCategories()
  const [categoryId, setCategoryId] = useState<string | undefined>()
  const [importance, setImportance] = useState<Importance | undefined>()
  const [sort, setSort] = useState<ItemSort>('importance')
  const [manage, setManage] = useState(false)

  const pool = (allItems ?? []).filter((i) => (showArchived ? i.archivedAt !== undefined : i.archivedAt === undefined))
  const activeCount = (allItems ?? []).filter((i) => i.archivedAt === undefined).length
  const archivedCount = (allItems ?? []).length - activeCount
  const validCategory = categoryId && categories?.some((c) => c.id === categoryId) ? categoryId : undefined
  const shown = filterAndSortItems(pool, {
    ...(validCategory ? { categoryId: validCategory } : {}),
    ...(importance ? { importance } : {}),
    sort,
  })
  const catName = new Map((categories ?? []).map((c) => [c.id, c.emoji ? `${c.emoji} ${c.name}` : c.name]))
  const filtered = validCategory !== undefined || importance !== undefined

  return (
    <AppScreen
      nav="wishlist"
      title="Wishlist"
      busy={allItems === undefined}
      // While the wishlist is empty, the empty state offers the same action, so the icon is left out.
      actions={activeCount > 0 ? <IconLink href="#/item/new" variant="frost" aria-label="Add a wish" icon={<Plus />} /> : undefined}
    >
      {(allItems?.length ?? 0) > 0 ? (
      <section className="app-stack app-stack--tight" aria-label="Filter and sort">
        <div className="app-chips" role="group" aria-label="Category">
          <Chip selected={validCategory === undefined} onClick={() => setCategoryId(undefined)}>
            All categories
          </Chip>
          {(categories ?? []).map((c) => (
            <Chip key={c.id} selected={validCategory === c.id} onClick={() => setCategoryId(validCategory === c.id ? undefined : c.id)}>
              {catName.get(c.id)}
            </Chip>
          ))}
          <Chip onClick={() => setManage(true)} avatar={<Tags size={16} />}>
            {categories && categories.length > 0 ? 'Edit categories' : 'Add categories'}
          </Chip>
        </div>
        <div className="app-chips" role="group" aria-label="Importance">
          <Chip selected={importance === undefined} onClick={() => setImportance(undefined)}>
            Any importance
          </Chip>
          {IMPORTANCE_ORDER.map((level) => (
            <Chip key={level} selected={importance === level} onClick={() => setImportance(importance === level ? undefined : level)}>
              {IMPORTANCE_LABEL[level]}
            </Chip>
          ))}
        </div>
        <div className="app-row app-row--nowrap wishlist-tools">
          <Select label="Sort" value={sort} onChange={(e) => isSort(e.target.value) && setSort(e.target.value)} className="wishlist-sort">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        {archivedCount > 0 || showArchived ? (
          <div>
            <Chip selected={showArchived} onClick={() => setShowArchived(!showArchived)}>
              {`Show archived (${archivedCount})`}
            </Chip>
          </div>
        ) : null}
      </section>
      ) : null}

      <section aria-label={showArchived ? 'Archived wishes' : 'Wishes'} aria-live="polite">
        {allItems === undefined ? (
          <div className="app-stack">
            <Skeleton height={56} shape="tile" />
            <Skeleton height={56} shape="tile" />
          </div>
        ) : shown.length === 0 ? (
          filtered ? (
            <EmptyState
              title={<TwoTone muted="No matches." bright="Try another filter." />}
              description="Nothing in your wishlist fits this category and importance together."
              action={
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    setCategoryId(undefined)
                    setImportance(undefined)
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : showArchived ? (
            <p className="app-note">Nothing is archived. Archived wishes stay here but are left off your shared lists.</p>
          ) : (
            <EmptyState
              title={<TwoTone muted="Your wishlist is empty." bright="Add something you would love." />}
              description="Paste a shop link or type a name. You can add details later."
              action={
                <LinkButton href="#/item/new" variant="primary" icon={<Plus />}>
                  Add a wish
                </LinkButton>
              }
            />
          )
        ) : (
          <List>
            {shown.map((item) => {
              const cats = item.categoryIds.map((id) => catName.get(id)).filter((n): n is string => Boolean(n))
              return (
                <ListRow
                  key={item.id}
                  href={`#/item/${item.id}`}
                  leading={<Thumb name={item.title} src={safeUrl(item.imageUrl)} size="md" />}
                  title={item.title}
                  secondary={
                    <span className="wishlist-meta">
                      <ImportanceMark level={importanceLevel(item.importance)} />
                      {cats.length > 0 ? <span className="wishlist-cats">{cats.join(', ')}</span> : null}
                      {item.quantity > 1 ? <span>{`× ${item.quantity}`}</span> : null}
                    </span>
                  }
                  trailing={item.price ? <MoneyText money={item.price} /> : undefined}
                />
              )
            })}
          </List>
        )}
      </section>
      <CategoriesSheet open={manage} onClose={() => setManage(false)} />
    </AppScreen>
  )
}
