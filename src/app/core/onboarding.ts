// First-run setup: whether to show it, where to resume, and how each answer
// moves the flow. Pure functions over the stored progress (core settings
// `onboarding`), so the rules are unit tested and the screens stay thin.
// This module is small and loads with the app (Home decides whether to start
// the flow); the flow's screens are a separate chunk.

import type { OnboardingState } from '../../core/index.ts'
import { WELCOME_STEPS, welcomeOrder, type WelcomeStep } from '../layout/routeMotion.ts'
import type { InstallPlacement } from '../pwa/guide.ts'

export { WELCOME_STEPS, welcomeOrder, type WelcomeStep }

/**
 * The steps in the order shown. Where the installed app keeps its own storage (iPhone, iPad, Safari
 * on a Mac, in-app browsers), installing comes straight after the opening screen, before any answer
 * that would be left behind in the browser. Elsewhere it comes before "add wishes from anywhere",
 * which can then count on it. Once Hippo runs installed there is no install step.
 */
export function welcomeStepsFor(placement: InstallPlacement): readonly WelcomeStep[] {
  switch (placement) {
    case 'first':
      return ['start', 'install', 'name', 'occasion', 'wish', 'capture']
    case 'late':
      return ['start', 'name', 'occasion', 'wish', 'install', 'capture']
    case 'none':
      return ['start', 'name', 'occasion', 'wish', 'capture']
  }
}

/** A saved step that this device's order leaves out (install, once running installed) resumes at the next step that exists. */
export function resolveStep(step: WelcomeStep, steps: readonly WelcomeStep[] = welcomeOrder()): WelcomeStep {
  if (steps.includes(step)) return step
  const all = welcomeStepsFor('late')
  for (let i = all.indexOf(step) + 1; i < all.length; i++) {
    const s = all[i]
    if (s && steps.includes(s)) return s
  }
  return steps[steps.length - 1] ?? 'start'
}

export const OCCASIONS = ['christmas', 'birthday', 'wedding', 'baby', 'justbecause', 'other'] as const
export type OccasionId = (typeof OCCASIONS)[number]

export interface Answers {
  name: string
  occasion: OccasionId | ''
  /** The occasion in the person's own words, for "Something else". */
  occasionText: string
  /** YYYY-MM-DD or empty. */
  date: string
  wish: string
}

export interface Flow {
  status: OnboardingState['status']
  step: WelcomeStep
  answers: Answers
  listId?: string
  itemId?: string
}

export type FlowEvent =
  | { type: 'next' }
  | { type: 'skip' }
  | { type: 'back' }
  | { type: 'dismiss' }
  | { type: 'answer'; patch: Partial<Answers> }
  | { type: 'created'; listId?: string; itemId?: string }

export function stepCount(steps: readonly WelcomeStep[] = welcomeOrder()): number {
  return steps.length
}

export function stepNumber(step: WelcomeStep, steps: readonly WelcomeStep[] = welcomeOrder()): number {
  return steps.indexOf(step) + 1
}

export function isWelcomeStep(s: string): s is WelcomeStep {
  return (WELCOME_STEPS as readonly string[]).includes(s)
}

const EMPTY: Answers = { name: '', occasion: '', occasionText: '', date: '', wish: '' }

function isOccasion(s: string | undefined): s is OccasionId {
  return s !== undefined && (OCCASIONS as readonly string[]).includes(s)
}

/** A fresh flow: the name is prefilled from settings and the occasion from the calendar. */
export function newFlow(opts: { ownerName?: string; today?: Date } = {}): Flow {
  const occasion = defaultOccasion(opts.today ?? new Date())
  return {
    status: 'active',
    step: 'start',
    answers: { ...EMPTY, name: opts.ownerName ?? '', occasion, date: occasion ? suggestedDate(occasion, opts.today ?? new Date()) : '' },
  }
}

export function fromStored(s: OnboardingState | undefined): Flow | null {
  if (!s) return null
  const a = s.answers
  const step = WELCOME_STEPS[s.step] ?? 'start'
  return {
    status: s.status,
    step,
    answers: {
      name: a.name ?? '',
      occasion: isOccasion(a.occasion) ? a.occasion : '',
      occasionText: a.occasionText ?? '',
      date: /^\d{4}-\d{2}-\d{2}$/.test(a.date ?? '') ? (a.date ?? '') : '',
      wish: a.wish ?? '',
    },
    ...(s.listId ? { listId: s.listId } : {}),
    ...(s.itemId ? { itemId: s.itemId } : {}),
  }
}

export function toStored(f: Flow, now: number): OnboardingState {
  const answers: Record<string, string> = {}
  for (const [k, v] of Object.entries(f.answers)) if (v) answers[k] = v.slice(0, 300)
  return {
    status: f.status,
    step: WELCOME_STEPS.indexOf(f.step),
    answers,
    ...(f.listId ? { listId: f.listId } : {}),
    ...(f.itemId ? { itemId: f.itemId } : {}),
    updatedAt: now,
  }
}

export function reduceFlow(f: Flow, e: FlowEvent, steps: readonly WelcomeStep[] = welcomeOrder()): Flow {
  const i = steps.indexOf(f.step)
  switch (e.type) {
    case 'answer':
      return { ...f, answers: { ...f.answers, ...e.patch } }
    case 'created':
      return { ...f, ...(e.listId ? { listId: e.listId } : {}), ...(e.itemId ? { itemId: e.itemId } : {}) }
    case 'back':
      return i > 0 ? { ...f, step: steps[i - 1] ?? 'start' } : f
    case 'dismiss':
      return { ...f, status: 'dismissed' }
    case 'next':
    case 'skip': {
      const next = steps[i + 1]
      return next ? { ...f, step: next } : { ...f, status: 'completed' }
    }
  }
}

export interface GateInput {
  stored: OnboardingState | undefined
  items: number
  lists: number
  /** Lists shared with me: someone who arrived as a giver is not pushed into owner setup. */
  guests: number
}

/**
 * The step to open when someone lands on Home, or null to show Home. Only Home
 * asks: share links (`#/l/`, `#/g/`) and deep-link captures (`#/item/new`)
 * never pass through here.
 */
export function onboardingStepFor({ stored, items, lists, guests }: GateInput): WelcomeStep | null {
  if (stored) return stored.status === 'active' ? resolveStep(WELCOME_STEPS[stored.step] ?? 'start') : null
  return items === 0 && lists === 0 && guests === 0 ? 'start' : null
}

// ---- Occasions ----

/** Christmas is preselected from October until Christmas Eve; otherwise nothing is. */
export function defaultOccasion(today: Date): OccasionId | '' {
  const m = today.getMonth()
  const d = today.getDate()
  return m >= 9 && !(m === 11 && d > 24) ? 'christmas' : ''
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** A date to suggest for an occasion: the next Christmas Day; nothing for occasions only the person knows. */
export function suggestedDate(occasion: OccasionId, today: Date): string {
  if (occasion !== 'christmas') return ''
  const y = today.getMonth() === 11 && today.getDate() > 25 ? today.getFullYear() + 1 : today.getFullYear()
  return iso(y, 12, 25)
}

/** The new list's name, from the answer. */
export function listNameFor(a: Pick<Answers, 'occasion' | 'occasionText' | 'date'>, today: Date = new Date()): string {
  const year = /^\d{4}/.test(a.date) ? a.date.slice(0, 4) : ''
  switch (a.occasion) {
    case 'christmas':
      return `Christmas ${year || String(today.getFullYear())}`
    case 'birthday':
      return year ? `Birthday ${year}` : 'Birthday'
    case 'wedding':
      return 'Wedding'
    case 'baby':
      return 'New baby'
    case 'justbecause':
      return 'Things I would love'
    case 'other':
      return a.occasionText.replace(/\s+/g, ' ').trim().slice(0, 100) || 'My list'
    case '':
      return 'My list'
  }
}

/** "for Christmas", "for your birthday": the occasion said back in a sentence; empty when there is none. */
export function occasionPhrase(a: Pick<Answers, 'occasion' | 'occasionText'>): string {
  switch (a.occasion) {
    case 'christmas':
      return 'for Christmas'
    case 'birthday':
      return 'for your birthday'
    case 'wedding':
      return 'for your wedding'
    case 'baby':
      return 'for the new baby'
    case 'other': {
      const t = a.occasionText.replace(/\s+/g, ' ').trim()
      return t ? `for ${t}` : ''
    }
    default:
      return ''
  }
}

// ---- "Get set up" checklist on Home ----

export interface ChecklistInput {
  stored: OnboardingState | undefined
  hiddenAt: number | undefined
  wishes: number
  sharedLists: number
  /** The recovery code was saved (it replaces "Save a backup": it brings the wishlist back on any device, and the backup file stays in Settings). */
  recoverySaved: boolean
  /** Installing: left out where it is not possible on this device; done once Hippo runs installed or was installed. */
  install?: { possible: boolean; done: boolean }
}

export interface ChecklistTask {
  id: 'install' | 'wishes' | 'share' | 'recovery'
  done: boolean
}

export const CHECKLIST_WISHES = 3

/** The checklist, or null when it should not show: before setup ends, once hidden, or once everything is done. */
export function setupChecklist(c: ChecklistInput): ChecklistTask[] | null {
  if (!c.stored || c.stored.status === 'active' || c.hiddenAt !== undefined) return null
  const tasks: ChecklistTask[] = [
    ...(c.install?.possible ? [{ id: 'install' as const, done: c.install.done }] : []),
    { id: 'wishes', done: c.wishes >= CHECKLIST_WISHES },
    { id: 'share', done: c.sharedLists > 0 },
    { id: 'recovery', done: c.recoverySaved },
  ]
  return tasks.every((t) => t.done) ? null : tasks
}
