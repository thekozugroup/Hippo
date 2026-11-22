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
  setupChecklist,
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
    expect(setupChecklist({ stored: done, hiddenAt: undefined, wishes: 1, sharedLists: 0, lastExportAt: undefined })).toEqual([
      { id: 'wishes', done: false },
      { id: 'share', done: false },
      { id: 'backup', done: false },
    ])
    expect(setupChecklist({ stored: done, hiddenAt: undefined, wishes: 3, sharedLists: 1, lastExportAt: 9 })).toBeNull()
    expect(setupChecklist({ stored: done, hiddenAt: 5, wishes: 0, sharedLists: 0, lastExportAt: undefined })).toBeNull()
  })
  it('does not show before or during setup, or for people who never had setup', () => {
    expect(setupChecklist({ stored: undefined, hiddenAt: undefined, wishes: 0, sharedLists: 0, lastExportAt: undefined })).toBeNull()
    expect(setupChecklist({ stored: stored({}), hiddenAt: undefined, wishes: 0, sharedLists: 0, lastExportAt: undefined })).toBeNull()
  })
})
