import type { Instant, Ns } from './types'

const MS = 1_000_000n

/** Milliseconds from `from` to `to` (positive when `to` is later). Both are nanosecond strings. */
export function diffMs(to: Ns, from: Ns): number {
  return Number((BigInt(to) - BigInt(from)) / MS)
}

/** A nanosecond string moved by whole milliseconds. */
export function addMs(t: Ns, ms: number): Ns {
  return (BigInt(t) + BigInt(Math.round(ms)) * MS).toString()
}

/** The wall-clock time of an instant in epoch ms: its UTC text when it has one, else the axis time (TAI, so about 37 s ahead). */
export function epochMs(i: Instant): number {
  if (i.utc) {
    const ms = Date.parse(i.utc)
    if (!Number.isNaN(ms)) return ms
  }
  return Number(BigInt(i.t) / MS)
}

const p = (n: number, l = 2) => String(n).padStart(l, '0')

/** HH:MM:SS.mmm of an instant's UTC text, or `--:--:--.---` when there is none. */
export function clockOf(i: Instant | null | undefined): string {
  if (!i?.utc) return '--:--:--.---'
  const d = new Date(i.utc)
  return Number.isNaN(d.getTime()) ? '--:--:--.---' : `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`
}

/** The timecode HH:MM:SS:FF from a frame on the output grid, or the clock with milliseconds when the grid is not known. */
export function timecodeOf(frame: { utc: string | null; frameInSecond: number | null } | null | undefined, at: Instant | null | undefined): string {
  if (frame?.utc && frame.frameInSecond !== null) {
    const d = new Date(frame.utc)
    if (!Number.isNaN(d.getTime())) return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}:${p(frame.frameInSecond)}`
  }
  return clockOf(at)
}

/** A length in ms as `s.mmm s` or `m:ss.s`. */
export function lengthOf(ms: number): string {
  const a = Math.abs(ms)
  return a >= 60_000 ? `${Math.floor(a / 60_000)}:${p(Math.floor((a % 60_000) / 1000))}.${Math.floor((a % 1000) / 100)}` : `${(a / 1000).toFixed(a < 10_000 ? 2 : 1)} s`
}
