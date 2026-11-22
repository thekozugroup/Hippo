import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowLeft,
  Bell,
  Cake,
  Coffee,
  Gift,
  House,
  ListChecks,
  Menu,
  Package,
  Plus,
  Search,
  Settings,
  Share2,
  Sparkles,
  Users,
} from 'lucide-react'
import { BigValue } from './components/BigValue.tsx'
import { BottomNav } from './components/BottomNav.tsx'
import { BottomSheet } from './components/BottomSheet.tsx'
import { Button, LinkButton } from './components/Button.tsx'
import { Checkbox } from './components/Checkbox.tsx'
import { Chip } from './components/Chip.tsx'
import { DotProgress } from './components/DotProgress.tsx'
import { EmptyState } from './components/EmptyState.tsx'
import { HeroBackground } from './components/HeroBackground.tsx'
import { IconButton } from './components/IconButton.tsx'
import { ImportanceMark } from './components/ImportanceMark.tsx'
import { List } from './components/List.tsx'
import { ListRow } from './components/ListRow.tsx'
import { Logo } from './components/Logo.tsx'
import { MoneyField } from './components/MoneyField.tsx'
import { MoneyText } from './components/MoneyText.tsx'
import { Screen } from './components/Screen.tsx'
import { SectionHeader } from './components/SectionHeader.tsx'
import { SegmentedControl } from './components/SegmentedControl.tsx'
import { Select } from './components/Select.tsx'
import { Sheet } from './components/Sheet.tsx'
import { Skeleton } from './components/Skeleton.tsx'
import { StatCard } from './components/StatCard.tsx'
import { StatusPill } from './components/StatusPill.tsx'
import type { Status } from './components/StatusPill.tsx'
import { Switch } from './components/Switch.tsx'
import { TextArea } from './components/TextArea.tsx'
import { TextField } from './components/TextField.tsx'
import { Thumb } from './components/Thumb.tsx'
import { Toast } from './components/Toast.tsx'
import { TopBar } from './components/TopBar.tsx'
import { TwoTone } from './components/TwoTone.tsx'
import './Gallery.css'

type Theme = 'light' | 'dark'
type Show = 'both' | Theme

const STATUSES: ReadonlyArray<Status> = ['available', 'partial', 'funded', 'claimed', 'purchased', 'removed', 'conflict', 'draft', 'published']

const BARS = [0.3, 0.2, 0.45, 0.25, 0.6, 0.35, 0.8, 0.5, 0.9, 0.7, 0.4, 0.55, 0.3, 0.65, 0.45, 0.25, 0.5, 0.35]
const BARS_2 = [0.2, 0.35, 0.25, 0.5, 0.3, 0.7, 0.45, 0.95, 0.8, 0.9, 0.4, 0.3, 0.55, 0.35, 0.25, 0.45, 0.2, 0.3]

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: <House /> },
  { id: 'lists', label: 'Lists', icon: <ListChecks /> },
  { id: 'share', label: 'Share', icon: <Share2 /> },
  { id: 'settings', label: 'Settings', icon: <Settings /> },
] as const

const SWATCHES: ReadonlyArray<readonly [string, string]> = [
  ['--bg', 'bg'],
  ['--surface', 'surface'],
  ['--surface-2', 'surface-2'],
  ['--surface-3', 'surface-3'],
  ['--text', 'text'],
  ['--text-2', 'text-2'],
  ['--text-3', 'text-3'],
  ['--accent', 'accent'],
  ['--danger', 'danger'],
  ['--success', 'success'],
]

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="gx-section">
      <h3 className="gx-section__title">{title}</h3>
      {note ? <p className="gx-section__note">{note}</p> : null}
      {children}
    </section>
  )
}

function ThemeFrame({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <div className="gx-frame theme-scope" data-theme={theme}>
      <p className="gx-frame__badge">{theme === 'light' ? 'Light theme' : 'Dark theme'}</p>
      {children}
    </div>
  )
}

function HomeDemo({ theme, full = false }: { theme: Theme; full?: boolean }) {
  const dark = theme === 'dark'
  return (
    <Screen
      contained={!full}
      sheetAs={full ? 'main' : 'div'}
      variant="blue"
      hero={
        <TopBar
          start={<IconButton variant="frost" aria-label="Open menu" icon={<Menu />} />}
          end={
            <>
              <Chip tone="frost" dot avatar={<Thumb name="Alex" size="xs" shape="round" />} onClick={() => undefined}>
                Alex M.
              </Chip>
              <IconButton variant="frost" aria-label="Notifications" icon={<Bell />} />
            </>
          }
        />
      }
      nav={<BottomNav items={NAV_ITEMS} activeId="home" label={`Main (${theme})`} />}
    >
      <p className="t-label t-muted">Wishlist</p>
      <BigValue value="24" secondary=" gifts" />
      <div className="gx-row gx-row--gap gx-mt">
        <Button variant="primary" icon={<Plus />} fullWidth>
          Add
        </Button>
        <Button variant="secondary" icon={<Share2 />} fullWidth>
          Share
        </Button>
      </div>
      <div className="gx-mt-lg">
        <SectionHeader title="Recent items" strong action={{ label: 'See all', href: '#/design' }} />
        <List>
          <ListRow
            leading={<Thumb name="Espresso machine" size="sm" />}
            title="Espresso machine"
            secondary="Today, 7:30 PM"
            trailing={<MoneyText money={{ amount: 24900, currency: 'USD' }} />}
            onClick={() => undefined}
          />
          <ListRow
            leading={<Thumb name="Trail running shoes" size="sm" />}
            title="Trail running shoes"
            secondary="Today, 4:15 PM"
            trailing={<MoneyText money={{ amount: 13050, currency: 'USD' }} />}
            onClick={() => undefined}
          />
        </List>
      </div>
      <div className="gx-grid-2 gx-mt-lg">
        <StatCard
          panel={dark}
          label="Shared lists"
          action={<Users />}
          bars={BARS}
          highlight={[3, 5]}
          value="3"
          caption="2 with claims"
        />
        <StatCard
          panel={dark}
          label="Funded"
          action={<Gift />}
          bars={BARS_2}
          highlight={[7, 9]}
          value={<MoneyText money={{ amount: 17320, currency: 'USD' }} muteFraction />}
          caption="62% of goal"
        />
      </div>
    </Screen>
  )
}

function ActivityPanel() {
  const rows = [
    { icon: <Coffee />, name: 'Espresso machine', status: 'partial' as const, value: 0.6, muted: 'is being funded by 3 friends', bright: 'Maya, Leo and Sam' },
    { icon: <Package />, name: 'Trail running shoes', status: 'claimed' as const, value: 1, muted: 'claimed by', bright: 'Jordan' },
    { icon: <Cake />, name: 'Birthday dinner voucher', status: 'available' as const, value: 0.15, muted: 'waiting for', bright: 'a first pledge' },
  ]
  return (
    <div className="gx-dash frost frost--panel">
      <div className="gx-dash__head">
        <p className="t-label t-muted">Birthday list</p>
        <StatusPill status="published" />
      </div>
      <div className="gx-dash__cards">
        {rows.map((r) => (
          <article key={r.name} className="gx-dash__card">
            <span className="gx-dash__tile" aria-hidden="true">
              {r.icon}
            </span>
            <div className="gx-dash__body">
              <div className="gx-dash__line">
                <h4 className="gx-dash__name">{r.name}</h4>
                <StatusPill status={r.status} />
              </div>
              <p className="gx-dash__task">
                <TwoTone bright={r.bright} muted={r.muted} />
              </p>
              <DotProgress label={`Funding for ${r.name}`} value={r.value} columns={14} showValue />
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function Showcase({ theme }: { theme: Theme }) {
  const [filter, setFilter] = useState('all')
  const [seg, setSeg] = useState<'grid' | 'list' | 'map'>('list')
  const [notify, setNotify] = useState(true)
  const [priv, setPriv] = useState(false)
  const [agree, setAgree] = useState(true)
  const [sheet, setSheet] = useState(false)
  const [toast, setToast] = useState(false)
  const [loading, setLoading] = useState(false)
  const dark = theme === 'dark'

  return (
    <div className="gx-stack">
      <Section title="Screen" note="Hero, sheet, floating nav. Light theme: blue hero and white sheet; dark theme: deep field with frost panels.">
        <HomeDemo theme={theme} />
      </Section>

      <Section title="Dark dashboard panel" note="Always dark. Frost panel with nested cards, status pills, dot progress and two-tone lines.">
        <div className="gx-on-field" data-theme="dark">
          <HeroBackground variant="dark" />
          <div className="gx-on-field__inner">
            <ActivityPanel />
          </div>
        </div>
      </Section>

      <Section title="Onboarding hero" note="Two-tone headline over the dark hero.">
        <Screen
          contained
          variant="dark"
          sheetAs="div"
          hero={<TopBar start={<Logo />} />}
          headline={
            <h2 className="t-headline">
              <TwoTone tone="on-hero" muted="Since last week" bright="3 gifts have been claimed!" />
            </h2>
          }
        >
          <p className="t-secondary t-muted">Every wish, one private link.</p>
          <div className="gx-mt">
            <Button variant="primary" fullWidth icon={<Sparkles />}>
              Start
            </Button>
          </div>
        </Screen>
      </Section>

      <Section title="Frost" note="Four variants. Uniform blur, flat tint, one hairline.">
        <div className="gx-frost-demo gx-frost-demo--hero">
          <HeroBackground />
          <div className="gx-frost-demo__row">
            <IconButton variant="frost" aria-label="Back" icon={<ArrowLeft />} />
            <Chip tone="frost">On hero</Chip>
            <Button variant="frost" size="md" icon={<Search />}>
              Search
            </Button>
          </div>
        </div>
        <div className="gx-on-field gx-on-field--short">
          <HeroBackground variant="dark" />
          <div className="gx-on-field__inner">
            <div className="frost frost--panel gx-panel-sample">
              <p className="t-label t-muted">Panel</p>
              <p className="t-title">Frost panel</p>
              <p className="t-secondary t-muted">Dark cards and panels.</p>
            </div>
          </div>
        </div>
        <div className="gx-frost-demo gx-frost-demo--scroll">
          <div className="gx-frost-demo__stripes" aria-hidden="true" />
          <div className="frost frost--bar gx-bar-sample">
            <span className="t-secondary">Sticky bar over content</span>
          </div>
        </div>
        <div className="gx-frost-demo gx-frost-demo--scroll">
          <div className="gx-frost-demo__stripes" aria-hidden="true" />
          <div className="frost frost--scrim gx-scrim-sample" aria-hidden="true">
            <span className="gx-scrim-sample__tag">Scrim</span>
          </div>
        </div>
      </Section>

      <Section title="Typography">
        <p className="t-display">$117.450<span className="t-faint">.17</span></p>
        <p className="t-headline">Headline 40</p>
        <p className="t-title">Title 22 for sections</p>
        <p className="t-body">Body 17 for reading, with comfortable tracking.</p>
        <p className="t-secondary t-muted">Secondary 15 for supporting lines.</p>
        <p className="t-label t-muted">Label 13 uppercase</p>
      </Section>

      <Section title="Colour tokens">
        <ul className="gx-swatches">
          {SWATCHES.map(([token, name]) => (
            <li key={token} className="gx-swatch">
              <span className="gx-swatch__chip" style={{ background: `var(${token})` }} aria-hidden="true" />
              <span className="t-secondary">{name}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Buttons">
        <div className="gx-row">
          <Button variant="primary" icon={<Plus />}>Add</Button>
          <Button variant="secondary" icon={<Share2 />}>Share</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Remove</Button>
        </div>
        <div className="gx-row">
          <Button variant="primary" size="md">Medium</Button>
          <Button variant="secondary" size="md">Medium</Button>
          <Button variant="primary" disabled>Disabled</Button>
          <Button variant="secondary" disabled>Disabled</Button>
        </div>
        <div className="gx-row">
          <Button
            variant="primary"
            loading={loading}
            onClick={() => {
              setLoading(true)
              window.setTimeout(() => setLoading(false), 1800)
            }}
          >
            {loading ? 'Saving' : 'Save list'}
          </Button>
          <Button variant="secondary" loading>Loading</Button>
          <LinkButton href="#/design" variant="secondary" size="md">Link button</LinkButton>
        </div>
        <div className="gx-on-hero">
          <HeroBackground />
          <div className="gx-on-hero__inner gx-row">
            <Button variant="frost" size="md" icon={<Gift />}>Frost</Button>
            <Button variant="frost" size="md" disabled>Frost disabled</Button>
          </div>
        </div>
      </Section>

      <Section title="Icon buttons">
        <div className="gx-row">
          <IconButton aria-label="Add item" icon={<Plus />} />
          <IconButton aria-label="Search" icon={<Search />} variant="ghost" />
          <IconButton aria-label="Add item, large" icon={<Plus />} size="lg" />
          <IconButton aria-label="Disabled" icon={<Bell />} disabled />
        </div>
        <div className="gx-on-hero">
          <HeroBackground />
          <div className="gx-on-hero__inner gx-row">
            <IconButton variant="frost" aria-label="Menu" icon={<Menu />} />
            <IconButton variant="frost" aria-label="Notifications" icon={<Bell />} size="lg" />
          </div>
        </div>
      </Section>

      <Section title="Chips">
        <div className="gx-row" role="group" aria-label="Filter items">
          {['all', 'available', 'claimed'].map((f) => (
            <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
              {f}
            </Chip>
          ))}
        </div>
        <div className="gx-row">
          <Chip avatar="🎂">Birthday</Chip>
          <Chip dot>Updates</Chip>
          <Chip avatar={<Thumb name="Maya" size="xs" shape="round" />}>Maya</Chip>
          <Chip href="#/design">Link chip</Chip>
        </div>
        <div className="gx-on-hero">
          <HeroBackground />
          <div className="gx-on-hero__inner gx-row">
            <Chip tone="frost" selected onClick={() => undefined}>Selected</Chip>
            <Chip tone="frost" selected={false} onClick={() => undefined}>Idle</Chip>
            <Chip tone="frost" dot avatar={<Thumb name="Alex" size="xs" shape="round" />}>Alex M.</Chip>
          </div>
        </div>
      </Section>

      <Section title="Status pills" note="Always a text label; the dot shape adds a second cue.">
        <div className="gx-row">
          {STATUSES.map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </div>
        {dark ? (
          <div className="gx-on-field gx-on-field--short">
            <HeroBackground variant="dark" />
            <div className="gx-on-field__inner gx-row">
              <div className="frost frost--panel gx-row gx-panel-sample">
                {STATUSES.map((s) => (
                  <StatusPill key={s} status={s} />
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Section header, list rows, thumbs">
        <SectionHeader title="Transactions" strong action={{ label: 'See all', href: '#/design' }} />
        <List>
          <ListRow
            leading={<Thumb name="Espresso machine" />}
            title="Espresso machine"
            secondary={<ImportanceMark level={3} />}
            trailing={<StatusPill status="available" />}
            href="#/design"
          />
          <ListRow
            leading={<Thumb name="Linen duvet cover" src="./missing-item.jpg" />}
            title="Linen duvet cover (queen size, sage)"
            secondary={<ImportanceMark level={2} />}
            trailing={<MoneyText money={{ amount: 18900, currency: 'USD' }} />}
            onClick={() => undefined}
          />
          <ListRow
            leading={<Thumb name="Cast iron pan" shape="round" />}
            title="Cast iron pan"
            secondary="Claimed by a friend"
            trailing={<StatusPill status="claimed" />}
          />
        </List>
        <div className="gx-row">
          <Thumb name="Ab" size="sm" />
          <Thumb name="Bike lights" size="md" />
          <Thumb name="Camera" size="lg" />
          <Thumb name="Dana" size="lg" shape="round" />
        </div>
      </Section>

      <Section title="Values">
        <p className="t-label t-muted">Total pledged</p>
        <BigValue>
          <MoneyText money={{ amount: 11745017, currency: 'USD' }} muteFraction />
        </BigValue>
        <BigValue value="12" secondary=" items" size="headline" />
        <p className="t-secondary">
          <MoneyText money={{ amount: 4900, currency: 'USD' }} compact /> and <MoneyText money={{ amount: 123456, currency: 'JPY' }} /> and{' '}
          <MoneyText money={{ amount: 2550, currency: 'EUR' }} locale="de-DE" />
        </p>
        <div className="gx-grid-2">
          <StatCard label="Lists" action={<Users />} bars={BARS} highlight={[2, 4]} value="4" caption="1 draft" />
          <StatCard label="Pledged" action={<Gift />} bars={BARS_2} highlight={[8, 11]} value={<MoneyText money={{ amount: 31250, currency: 'USD' }} muteFraction />} caption="44.6%" />
        </div>
      </Section>

      <Section title="Dot progress, importance">
        <DotProgress label="Funding for Espresso machine" value={0} showValue />
        <DotProgress label="Funding for Cast iron pan" value={0.35} valueText="$70 of $200" showValue />
        <DotProgress label="Funding for Camera" value={0.72} showValue />
        <DotProgress label="Funding for Trail shoes" value={1} showValue />
        <div className="gx-row">
          <ImportanceMark level={1} />
          <ImportanceMark level={2} />
          <ImportanceMark level={3} />
        </div>
      </Section>

      <Section title="Form controls">
        <TextField label="Item name" placeholder="Espresso machine" defaultValue="" />
        <TextField label="Link" hint="Paste a store link; we keep it private." defaultValue="https://shop.example/espresso" />
        <TextField label="Nickname" defaultValue="" error="Add a name your friends will recognise." />
        <MoneyField label="Price" currency="USD" defaultValue="249.00" hint="Optional" />
        <MoneyField label="Price" currency="EUR" locale="de-DE" defaultValue="" placeholder="0,00" error="Enter an amount." />
        <Select label="List" defaultValue="birthday">
          <option value="birthday">Birthday 2027</option>
          <option value="wedding">Wedding</option>
          <option value="home">New home</option>
        </Select>
        <TextArea label="Note to givers" defaultValue="Size M or L is perfect." hint="Shown on the shared list." />
        <TextField label="Disabled" defaultValue="Locked value" disabled />
      </Section>

      <Section title="Switch, segmented control, checkbox">
        <Switch label="Show prices" description="Givers see what each gift costs." checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        <Switch label="Hide claimed items" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
        <Switch label="Disabled switch" disabled />
        <SegmentedControl
          label="Item layout"
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'list', label: 'List' },
            { value: 'map', label: 'Map' },
          ]}
        />
        <Checkbox label="Let friends pledge part of a gift" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <Checkbox label="Disabled checkbox" disabled />
      </Section>

      <Section title="Bottom nav">
        <div className="gx-nav-demo">
          <BottomNav items={NAV_ITEMS} activeId="lists" label={`Lists nav (${theme})`} />
        </div>
      </Section>

      <Section title="Bottom sheet, toast">
        <div className="gx-row">
          <Button variant="secondary" size="md" onClick={() => setSheet(true)}>
            Open sheet
          </Button>
          <Button variant="secondary" size="md" onClick={() => setToast(true)}>
            Show toast
          </Button>
        </div>
        <Toast inline open={toast} message="Link copied to clipboard" onDismiss={() => setToast(false)} />
        <BottomSheet
          open={sheet}
          onClose={() => setSheet(false)}
          title="Claim this gift"
          description="Cast iron pan, $89.00"
        >
          <TextField label="Your name (optional)" placeholder="Jordan" />
          <MoneyField label="Pledge amount" currency="USD" defaultValue="30.00" />
          <Button variant="primary" fullWidth onClick={() => setSheet(false)}>
            Confirm pledge
          </Button>
        </BottomSheet>
      </Section>

      <Section title="Empty state, skeleton, logo">
        <Sheet className="gx-sheet-sample">
          <EmptyState
            icon={<Gift />}
            title={<TwoTone muted="No gifts yet." bright="Add the first thing you would love." />}
            description="Wishes stay private until you share the list."
            action={<Button variant="primary" icon={<Plus />}>Add item</Button>}
          />
        </Sheet>
        <div className="gx-skeletons" aria-busy="true">
          <Skeleton shape="circle" width={56} height={56} />
          <div className="gx-skeletons__lines">
            <Skeleton width="60%" height={18} />
            <Skeleton width="40%" height={14} />
          </div>
        </div>
        <Skeleton shape="tile" height={96} />
        <div className="gx-row gx-row--center">
          <Logo size={40} />
          <Logo size={32} markOnly />
          <div className="gx-on-hero gx-logo-hero">
            <HeroBackground />
            <div className="gx-on-hero__inner">
              <Logo size={32} />
            </div>
          </div>
        </div>
      </Section>
    </div>
  )
}

function hashParams(): URLSearchParams {
  try {
    return new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  } catch {
    return new URLSearchParams()
  }
}

function initialShow(): Show {
  const v = hashParams().get('show')
  return v === 'light' || v === 'dark' ? v : 'both'
}

/** Renders every component and state in both themes for visual review. */
export function Gallery() {
  const [show, setShow] = useState<Show>(initialShow)
  // `#/design?screen=light|dark` previews the home screen full-bleed (not in a frame).
  const fullScreen = hashParams().get('screen')
  if (fullScreen === 'light' || fullScreen === 'dark') {
    return (
      <div data-theme={fullScreen}>
        <HomeDemo theme={fullScreen} full />
      </div>
    )
  }
  return (
    <div className="gx">
      <header className="gx-header">
        <Logo size={32} />
        <h1 className="t-title">Design gallery</h1>
        <SegmentedControl<Show>
          label="Themes to show"
          value={show}
          onChange={setShow}
          options={[
            { value: 'both', label: 'Both' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </header>
      <div className={show === 'both' ? 'gx-frames gx-frames--both' : 'gx-frames'}>
        {show !== 'dark' ? (
          <ThemeFrame theme="light">
            <Showcase theme="light" />
          </ThemeFrame>
        ) : null}
        {show !== 'light' ? (
          <ThemeFrame theme="dark">
            <Showcase theme="dark" />
          </ThemeFrame>
        ) : null}
      </div>
    </div>
  )
}
