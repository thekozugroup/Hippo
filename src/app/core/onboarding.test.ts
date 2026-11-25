import { describe, expect, it } from 'vitest'
import type { OnboardingState } from '../../core/index.ts'
import {
  defaultOccasion,
  fromStored,
  listNameFor,
  newFlow,
  occasionPhrase,
  onboardingStepFor,
  reduceFlow,
  resolveStep,
  setupChecklist,
  stepNumber,
  welcomeStepsFor,
  suggestedDate,
  toStored,
  type Flow,
} from './onboarding.ts'

const NOV = new Date(2026, 10, 22)
const MAR = new Date(2026, 2, 3)

function stored(partial: Partial<OnboardingState>): OnboardingState {
  return { status: 'active', step: 0, answers: {}, updatedAt: 1, ...partial }
}

describe('when setup shows', () => {
  it('shows for a new owner with nothing on the device', () => {
    expect(onboardingStepFor({ stored: undefined, items: 0, lists: 0, guests: 0 })).toBe('start')
  })

  it('is not shown to someone who arrived as a giver', () => {
    expect(onboardingStepFor({ stored: undefined, items: 0, lists: 0, guests: 1 })).toBeNull()
  })

  it('is not shown to an owner who already has wishes or lists', () => {
    expect(onboardingStepFor({ stored: undefined, items: 2, lists: 0, guests: 0 })).toBeNull()
    expect(onboardingStepFor({ stored: undefined, items: 0, lists: 1, guests: 0 })).toBeNull()
  })

  it('is never shown again once completed or closed, even on an empty device', () => {
    expect(onboardingStepFor({ stored: stored({ status: 'completed', step: 4 }), items: 0, lists: 0, guests: 0 })).toBeNull()
    expect(onboardingStepFor({ stored: stored({ status: 'dismissed', step: 0 }), items: 0, lists: 0, guests: 0 })).toBeNull()
  })

  it('resumes at the saved step, even though the flow already created a list and a wish', () => {
    expect(onboardingStepFor({ stored: stored({ step: 3, listId: 'l1', itemId: 'i1' }), items: 1, lists: 1, guests: 0 })).toBe('wish')
  })
})

describe('moving through the flow', () => {
  const start: Flow = newFlow({ ownerName: 'Ann', today: NOV })

  it('starts with real defaults: the saved name, Christmas in season with Christmas Day', () => {
    expect(start.answers).toMatchObject({ name: 'Ann', occasion: 'christmas', date: '2026-12-25' })
    expect(newFlow({ today: MAR }).answers).toMatchObject({ name: '', occasion: '', date: '' })
  })

  it('goes forward on next and skip, back on back, and keeps every answer', () => {
    let f = reduceFlow(start, { type: 'next' })
    expect(f.step).toBe('name')
    f = reduceFlow(f, { type: 'answer', patch: { name: 'Annie' } })
    f = reduceFlow(f, { type: 'skip' })
    expect(f.step).toBe('occasion')
    f = reduceFlow(f, { type: 'back' })
    expect(f.step).toBe('name')
    expect(f.answers.name).toBe('Annie')
    expect(reduceFlow(start, { type: 'back' }).step).toBe('start')
  })

  it('completes after the last step and can be dismissed from any step without losing answers', () => {
    let f: Flow = { ...start, step: 'capture' }
    f = reduceFlow(f, { type: 'next' })
    expect(f.status).toBe('completed')
    const closed = reduceFlow({ ...start, step: 'wish', answers: { ...start.answers, wish: 'Socks' } }, { type: 'dismiss' })
    expect(closed.status).toBe('dismissed')
    expect(closed.answers.wish).toBe('Socks')
  })

  it('remembers the list and wish it created so going back edits them', () => {
    const f = reduceFlow(reduceFlow(start, { type: 'created', listId: 'L' }), { type: 'created', itemId: 'I' })
    expect(f).toMatchObject({ listId: 'L', itemId: 'I' })
  })

  it('survives a round trip through storage (resume after closing the app)', () => {
    const f: Flow = { ...start, step: 'occasion', answers: { ...start.answers, occasion: 'other', occasionText: 'Graduation' }, listId: 'L' }
    const back = fromStored(toStored(f, 5))
    expect(back).toEqual(f)
    expect(fromStored(stored({ step: 99, answers: { occasion: 'nonsense', date: 'soon' } }))).toMatchObject({ step: 'start', answers: { occasion: '', date: '' } })
  })
})

describe('occasion answers', () => {
  it('names the list from the answer', () => {
    expect(listNameFor({ occasion: 'christmas', occasionText: '', date: '2026-12-25' })).toBe('Christmas 2026')
    expect(listNameFor({ occasion: 'birthday', occasionText: '', date: '' })).toBe('Birthday')
    expect(listNameFor({ occasion: 'birthday', occasionText: '', date: '2027-04-02' })).toBe('Birthday 2027')
    expect(listNameFor({ occasion: 'other', occasionText: '  Moving   house ', date: '' })).toBe('Moving house')
    expect(listNameFor({ occasion: 'other', occasionText: 'x'.repeat(300), date: '' })).toHaveLength(100)
  })

  it('suggests a date only where one is known, and says the occasion back', () => {
    expect(suggestedDate('christmas', new Date(2026, 11, 26))).toBe('2027-12-25')
    expect(suggestedDate('wedding', NOV)).toBe('')
    expect(defaultOccasion(new Date(2026, 11, 27))).toBe('')
    expect(occasionPhrase({ occasion: 'birthday', occasionText: '' })).toBe('for your birthday')
    expect(occasionPhrase({ occasion: 'justbecause', occasionText: '' })).toBe('')
  })
})

describe('the Get set up checklist', () => {
  const done = stored({ status: 'completed', step: 4 })
  it('tracks real state and goes away when complete or hidden', () => {
    expect(setupChecklist({ stored: done, hiddenAt: undefined, wishes: 1, sharedLists: 0, recoverySaved: false })).toEqual([
      { id: 'wishes', done: false },
      { id: 'share', done: false },
      { id: 'recovery', done: false },
    ])
    expect(setupChecklist({ stored: done, hiddenAt: undefined, wishes: 3, sharedLists: 1, recoverySaved: true })).toBeNull()
    expect(setupChecklist({ stored: done, hiddenAt: 5, wishes: 0, sharedLists: 0, recoverySaved: false })).toBeNull()
  })
  it('does not show before or during setup, or for people who never had setup', () => {
    expect(setupChecklist({ stored: undefined, hiddenAt: undefined, wishes: 0, sharedLists: 0, recoverySaved: false })).toBeNull()
    expect(setupChecklist({ stored: stored({}), hiddenAt: undefined, wishes: 0, sharedLists: 0, recoverySaved: false })).toBeNull()
  })
})

describe('where the install step goes', () => {
  it('straight after the opening screen where the installed app keeps its own storage, before any question', () => {
    const first = welcomeStepsFor('first')
    expect(first).toEqual(['start', 'install', 'name', 'occasion', 'wish', 'capture'])
    expect(first.indexOf('install')).toBeLessThan(first.indexOf('name'))
  })
  it('before "add wishes from anywhere" where browser and app share storage', () => {
    expect(welcomeStepsFor('late')).toEqual(['start', 'name', 'occasion', 'wish', 'install', 'capture'])
  })
  it('nowhere, and not counted in the progress, once Hippo runs installed', () => {
    const none = welcomeStepsFor('none')
    expect(none).not.toContain('install')
    expect(none).toHaveLength(5)
    expect(stepNumber('capture', none)).toBe(5)
    expect(stepNumber('capture', welcomeStepsFor('late'))).toBe(6)
  })
  it('moves through the steps in the device’s order, and Back returns the same way', () => {
    const order = welcomeStepsFor('first')
    const start = newFlow({ today: NOV })
    const next = reduceFlow(start, { type: 'next' }, order)
    expect(next.step).toBe('install')
    expect(reduceFlow(next, { type: 'skip' }, order).step).toBe('name')
    expect(reduceFlow({ ...start, step: 'name' }, { type: 'back' }, order).step).toBe('install')
    const late = welcomeStepsFor('late')
    expect(reduceFlow({ ...start, step: 'wish' }, { type: 'next' }, late).step).toBe('install')
    expect(reduceFlow({ ...start, step: 'install' }, { type: 'next' }, late).step).toBe('capture')
  })
  it('resumes a saved install step at the next step when this device has none', () => {
    expect(resolveStep('install', welcomeStepsFor('none'))).toBe('capture')
    expect(resolveStep('install', welcomeStepsFor('first'))).toBe('install')
    expect(resolveStep('name', welcomeStepsFor('none'))).toBe('name')
  })
  it('keeps saved progress from before the install step meaning the same step', () => {
    // Step indexes are stored; "capture" was index 4 before installing had a step, and still is.
    expect(fromStored(stored({ step: 4 }))?.step).toBe('capture')
    expect(toStored({ ...newFlow({ today: NOV }), step: 'install' }, 1).step).toBe(5)
    expect(fromStored(stored({ step: 5 }))?.step).toBe('install')
  })
})

describe('the install task on the checklist', () => {
  const done = stored({ status: 'completed', step: 4 })
  const base = { stored: done, hiddenAt: undefined, wishes: 0, sharedLists: 0, recoverySaved: false }
  it('comes first where installing is possible, ticked once installed', () => {
    expect(setupChecklist({ ...base, install: { possible: true, done: false } })?.[0]).toEqual({ id: 'install', done: false })
    expect(setupChecklist({ ...base, install: { possible: true, done: true } })?.[0]).toEqual({ id: 'install', done: true })
  })
  it('is left out where installing is not possible', () => {
    expect(setupChecklist({ ...base, install: { possible: false, done: false } })?.map((t) => t.id)).toEqual(['wishes', 'share', 'recovery'])
  })
  it('counts towards the checklist going away', () => {
    expect(setupChecklist({ ...base, wishes: 3, sharedLists: 1, recoverySaved: true, install: { possible: true, done: false } })).toEqual([
      { id: 'install', done: false },
      { id: 'wishes', done: true },
      { id: 'share', done: true },
      { id: 'recovery', done: true },
    ])
    expect(setupChecklist({ ...base, wishes: 3, sharedLists: 1, recoverySaved: true, install: { possible: true, done: true } })).toBeNull()
  })
})
