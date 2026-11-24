import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { useLocation } from 'wouter'
import { Button, EmptyState, IconLink, LinkButton, List, SectionHeader, Skeleton, TextField, TwoTone } from '../../../ui/index.ts'
import { useGuestLists, useItems, useSharedLists } from '../../core/data.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { GuestListRow, OwnedListRow } from './ListRows.tsx'
import { payloadFromPastedLink } from '../../lib/site-address.ts'
import { isNativeApp } from '../../native/platform.ts'

/**
 * Android app only: a list link received in a chat may open in the browser (Android opens links to
 * the website in the app only after the person allows it), so it can also be pasted here.
 */
function OpenFromLink() {
  const [, navigate] = useLocation()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>()
  const open = (e: FormEvent) => {
    e.preventDefault()
    const payload = payloadFromPastedLink(value)
    if (!payload) {
      setError('This is not a Hippo list link. Paste the whole link you were sent.')
      return
    }
    setError(undefined)
    setValue('')
    navigate(`/l/${payload}`)
  }
  return (
    <form className="app-stack app-stack--tight" onSubmit={open} noValidate>
      <TextField
        label="Open a list from a link"
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="https://"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setError(undefined)
        }}
        {...(error ? { error } : {})}
      />
      <div>
        <Button type="submit" variant="secondary" size="md">
          Open list
        </Button>
      </div>
    </form>
  )
}

export function ListsScreen() {
  const lists = useSharedLists()
  const guests = useGuestLists()
  const items = useItems()
  const live = new Set((items ?? []).map((i) => i.id))
  const hasLists = (lists?.length ?? 0) > 0

  return (
    <AppScreen
      nav="lists"
      width="wide"
      title="Lists"
      // With no lists yet, the empty state below offers the same action, so the icon is left out.
      actions={hasLists ? <IconLink href="#/list/new" variant="frost" aria-label="Make a list" icon={<Plus />} /> : undefined}
      busy={lists === undefined || guests === undefined}
    >
      <section aria-labelledby="lists-mine" className="app-stack">
        <SectionHeader title={<span id="lists-mine">Your lists</span>} />
        {lists === undefined ? (
          <Skeleton height={64} shape="tile" />
        ) : lists.length === 0 ? (
          <EmptyState
            title={<TwoTone muted="No lists yet." bright="Make one for your next occasion." />}
            description="Pick wishes for a birthday, a wedding or the holidays, then send the link. Friends see only what you put on the list."
            action={
              <LinkButton href="#/list/new" variant="primary" icon={<Plus />}>
                Make a list
              </LinkButton>
            }
          />
        ) : (
          <List layout="cards">
            {lists.map((l) => (
              <OwnedListRow key={l.id} list={l} liveCount={l.itemIds.filter((id) => live.has(id)).length} />
            ))}
          </List>
        )}
      </section>

      <section aria-labelledby="lists-guest" className="app-stack">
        <SectionHeader title={<span id="lists-guest">Shared with me</span>} />
        {guests === undefined ? (
          <Skeleton height={64} shape="tile" />
        ) : guests.length === 0 ? (
          <p className="app-note">Lists friends send you appear here once you open their link on this device.</p>
        ) : (
          <List layout="cards">
            {guests.map((g) => (
              <GuestListRow key={g.topic} guest={g} />
            ))}
          </List>
        )}
        {isNativeApp() ? <OpenFromLink /> : null}
      </section>
    </AppScreen>
  )
}
