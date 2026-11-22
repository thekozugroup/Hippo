import { describeClockOffset } from '../../core/index.ts'

/** The sentence for an offset (positive: the device clock is behind). */
export function clockNoticeText(offsetMs: number): string {
  const way = offsetMs > 0 ? 'behind' : 'ahead'
  return `The clock on this device is about ${describeClockOffset(offsetMs)} ${way}. Hippo uses the correct time instead, so everyone sees the same gifts. You can fix the clock in your device settings.`
}
