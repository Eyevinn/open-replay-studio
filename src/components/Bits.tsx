import type { ReactNode } from 'react'
import type { Stream } from '../model'
import { formatDuration, formatWhen } from '../lib/format'

export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent'; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

export function TagList({ tags }: { tags: Record<string, string> }) {
  const entries = Object.entries(tags)
  if (entries.length === 0) return <span className="muted">no tags</span>
  return (
    <span className="tags">
      {entries.map(([k, v]) => (
        <span key={k} className="tag">
          {k}={v}
        </span>
      ))}
    </span>
  )
}

/** Live, or when it ended and how long it ran. */
export function RecordedState({ stream, now }: { stream: Stream; now: number }) {
  if (stream.endedAt === null) {
    return (
      <span className="live">
        <span className="dot dot-live" aria-hidden="true" />
        Live · {formatDuration(now - stream.startedAt)}
        {stream.lagMs > 3000 && <Pill tone="warn">{Math.round(stream.lagMs / 1000)} s behind</Pill>}
      </span>
    )
  }
  return (
    <span className="muted">
      {formatWhen(stream.endedAt, now)} · {formatDuration(stream.endedAt - stream.startedAt)}
    </span>
  )
}
