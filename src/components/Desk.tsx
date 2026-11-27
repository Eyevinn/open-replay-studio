import { useCallback, useEffect, useRef, useState } from 'react'
import { WhepVideo } from './WhepVideo'
import { useBitstrip } from '../lib/useBitstrip'
import type { Mixer, ReplayStatus } from '../lib/replayApi'

type Running = Extract<ReplayStatus, { running: true }>

// Sources a frame or so apart look in sync; further apart, cuts between them jump.
const OK_MS = 40
const WARN_MS = 120
const syncTone = (ms: number) => (ms <= OK_MS ? 'ok' : ms <= WARN_MS ? 'warn' : 'bad')

/** One source of the strip: its video, and how far behind the leading source it is, read from its bit strip. */
function SourceTile({ source, role, busy, behindMs, onDelay, onPick }: {
  source: Running['sources'][number]
  role: '' | 'pgm' | 'pvw'
  busy: boolean
  /** How far behind the leading source this one is, or null when not known yet. */
  behindMs: number | null
  onDelay: (index: number, ms: number | null) => void
  onPick: (index: number) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const delay = useBitstrip(video)
  useEffect(() => onDelay(source.index, delay), [delay, source.index, onDelay])
  return (
    <li>
      <button className={`source ${role}`} disabled={busy} onClick={() => onPick(source.index)} aria-pressed={role === 'pvw'} title={`Put ${source.label} in preview (${source.index + 1})`}>
        <WhepVideo url={source.url} label={source.label} videoRef={video} />
        <span className="source-label">
          <b>{source.index + 1}</b> {source.label}
          {role === 'pgm' && <span className="tag tag-pgm">PGM</span>}
          {role === 'pvw' && <span className="tag tag-pvw">PVW</span>}
          {behindMs !== null && (
            <span className={`sync sync-${syncTone(behindMs)}`} title={behindMs === 0 ? 'The leading source' : `${Math.round(behindMs)} ms behind the leading source, read from the bit strip`}>
              {behindMs === 0 ? 'lead' : `+${Math.round(behindMs)} ms`}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

/**
 * The operator's view of a running replay: the source in preview, what is on air, and a strip of every source, each on
 * its own connection. Click a source to put it in preview. Taking it out is on the control bar at the bottom of the page.
 */
export function Desk({ status, mixer, busy, onPreview }: { status: Running; mixer: Mixer; busy: boolean; onPreview: (index: number) => void }) {
  const { sources } = status
  const [delays, setDelays] = useState<Record<number, number | null>>({})
  const [waited, setWaited] = useState(false)
  const onDelay = useCallback((index: number, ms: number | null) => setDelays((d) => (d[index] === ms ? d : { ...d, [index]: ms })), [])
  useEffect(() => {
    const id = setTimeout(() => setWaited(true), 20_000)
    return () => clearTimeout(id)
  }, [])
  const known = Object.values(delays).filter((d): d is number => d !== null)
  const lead = known.length > 0 ? Math.min(...known) : null
  const behind = (i: number) => (lead !== null && typeof delays[i] === 'number' ? (delays[i] as number) - lead : null)
  const spread = known.length > 1 && lead !== null ? Math.max(...known) - lead : null
  const clips = status.clipPlayers.map((c) => ({ index: c.index, label: c.label }))
  const preview = mixer.preview !== null ? [...sources, ...clips].find((s) => s.index === mixer.preview) : undefined
  const program = mixer.program !== null ? clips.find((s) => s.index === mixer.program) : undefined

  return (
    <div className="desk-view">
      <div className="monitors">
        <figure className="monitor monitor-pvw">
          {/* One connection for good: the mixer behind it cuts to whatever is in preview, so a click opens nothing new. */}
          <WhepVideo url={status.previewUrl} label="Preview" />
          <figcaption>
            <span className="tag tag-pvw">PVW</span> {preview?.label ?? 'Nothing in preview'}
            {program && (
              <>
                {' '}
                <span className="tag tag-pgm">PGM</span> {program.label}
              </>
            )}
          </figcaption>
        </figure>
      </div>

      <ul className="strip" aria-label="Sources">
        {sources.map((s) => (
          <SourceTile key={s.index} source={s} role={s.index === mixer.program ? 'pgm' : s.index === mixer.preview ? 'pvw' : ''} busy={busy} behindMs={behind(s.index)} onDelay={onDelay} onPick={onPreview} />
        ))}
      </ul>
      <p className="hint sync-note">
        {spread !== null ? (
          <>
            Sources are within <b className={`sync-${syncTone(spread)}`}>{Math.round(spread)} ms</b> of each other, read from the bit strip burned into each picture.
          </>
        ) : known.length === 1 ? (
          'Only one source shows a bit strip, so there is nothing to compare it with.'
        ) : waited ? (
          'No bit strip found in these sources. Turn on latency burn-in in the Open Live production to measure how far apart they are.'
        ) : (
          'Reading the bit strip of each source…'
        )}
      </p>
    </div>
  )
}
