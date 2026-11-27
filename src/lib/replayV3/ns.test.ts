import { describe, expect, it } from 'vitest'
import { addMs, clockOf, diffMs, epochMs, lengthOf, timecodeOf } from './ns'

const at = (t: string, utc: string | null = null) => ({ t, utc })

describe('time on the group axis', () => {
  it('measures the distance between two nanosecond strings in milliseconds, later minus earlier', () => {
    expect(diffMs('3000000000', '1000000000')).toBe(2000)
    expect(diffMs('1000000000', '3000000000')).toBe(-2000)
  })

  it('does not lose precision above 2^53 nanoseconds', () => {
    const t = '1800000000123456789'
    expect(addMs(t, 1)).toBe('1800000000124456789')
    expect(diffMs(addMs(t, 250), t)).toBe(250)
  })

  it('moves a time by whole milliseconds, backwards too, and rounds a fraction', () => {
    expect(addMs('5000000000', -1500)).toBe('3500000000')
    expect(addMs('5000000000', 0.6)).toBe('5001000000')
  })

  it('reads the wall clock from the UTC text, and falls back to the axis time', () => {
    expect(epochMs(at('1', '2026-11-27T14:20:07.123Z'))).toBe(Date.parse('2026-11-27T14:20:07.123Z'))
    expect(epochMs(at('1800000000000000000'))).toBe(1_800_000_000_000)
  })
})

describe('showing a time', () => {
  it('shows the clock with milliseconds, or dashes when there is none', () => {
    expect(clockOf(at('1', '2026-11-27T14:20:07.123Z'))).toBe('14:20:07.123')
    expect(clockOf(at('1'))).toBe('--:--:--.---')
    expect(clockOf(null)).toBe('--:--:--.---')
  })

  it('shows the timecode HH:MM:SS:FF when the frame is known, else the clock', () => {
    expect(timecodeOf({ utc: '2026-11-27T14:20:07.000Z', frameInSecond: 12 }, null)).toBe('14:20:07:12')
    expect(timecodeOf(null, at('1', '2026-11-27T14:20:07.500Z'))).toBe('14:20:07.500')
  })

  it('shows a length as seconds under a minute, else minutes and seconds', () => {
    expect(lengthOf(2500)).toBe('2.50 s')
    expect(lengthOf(25_000)).toBe('25.0 s')
    expect(lengthOf(65_000)).toBe('1:05.0')
  })
})
