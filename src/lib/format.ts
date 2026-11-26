const pad = (n: number) => String(n).padStart(2, '0')

/** "2 h 14 m", "48 m", "9 s". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h} h ${pad(m)} m`
  if (m > 0) return `${m} m`
  return `${total} s`
}

/** "0:08", "1:12". */
export function formatClipLength(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${pad(s % 60)}`
}

/** Local clock time, "10:42:11". */
export function formatClock(epochMs: number): string {
  const d = new Date(epochMs)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** "Today 10:42", "Yesterday 14:00", "22 Nov 14:00". */
export function formatWhen(epochMs: number, now = Date.now()): string {
  const d = new Date(epochMs)
  const today = new Date(now)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((dayStart(today) - dayStart(d)) / 86_400_000)
  if (days === 0) return `Today ${time}`
  if (days === 1) return `Yesterday ${time}`
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${time}`
}

export const formatSpeed = (speed: number) => `${Math.round(speed * 100)}%`
