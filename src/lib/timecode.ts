const p = (n: number, l = 2) => String(Math.trunc(n)).padStart(l, '0')

/** Local wall-clock time as HH:MM:SS. */
export function formatClock(utcMs: number): string {
  const d = new Date(utcMs)
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Local wall-clock timecode as HH:MM:SS:FF, with FF counted at `fps` (like a broadcast timecode). */
export function formatTimecode(utcMs: number, fps: number): string {
  const d = new Date(utcMs)
  const frame = Math.min(fps - 1, Math.floor((d.getMilliseconds() / 1000) * fps))
  return `${formatClock(utcMs)}:${p(frame)}`
}
