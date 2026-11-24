import { sheetUnderStatusBar, UNDER_HYSTERESIS } from './statusArea.ts'

describe('status area', () => {
  it('does nothing without a top inset or a sheet', () => {
    expect(sheetUnderStatusBar(-100, 0, false)).toBe(false)
    expect(sheetUnderStatusBar(undefined, 32, true)).toBe(false)
  })

  it('counts the sheet as under once its edge reaches the icons, and lets go only clearly below', () => {
    expect(sheetUnderStatusBar(200, 32, false)).toBe(false)
    expect(sheetUnderStatusBar(17, 32, false)).toBe(false)
    expect(sheetUnderStatusBar(16, 32, false)).toBe(true)
    // Crossing back and forth by a pixel or two does not flip it.
    expect(sheetUnderStatusBar(18, 32, true)).toBe(true)
    expect(sheetUnderStatusBar(16 + UNDER_HYSTERESIS, 32, true)).toBe(true)
    expect(sheetUnderStatusBar(17 + UNDER_HYSTERESIS, 32, true)).toBe(false)
  })
})
