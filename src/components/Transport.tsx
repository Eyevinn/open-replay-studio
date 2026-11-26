import { useEffect, useState, type ReactNode } from 'react'
import { WINDOW_MS, type Clock, type ReplayController } from '../lib/controller'
import { formatClock, formatTimecode } from '../lib/timecode'
import { useReplayState } from '../lib/useReplay'

const JUMP_MS = 10_000

// The playhead's clock, read off the controller on a timer so only the small components that
// show it re-render, not the whole transport.
function useClock(controller: ReplayController, everyMs: number): Clock | null {
  const [clock, setClock] = useState<Clock | null>(() => controller.clock())
  useEffect(() => {
    const id = setInterval(() => setClock(controller.clock()), everyMs)
    return () => clearInterval(id)
  }, [controller, everyMs])
  return clock
}

/** The playhead box. `lead` goes at its start: what the replay is and whether it is connected and live. */
export function Timecode({ controller, lead }: { controller: ReplayController; lead?: ReactNode }) {
  const clock = useClock(controller, 40)
  const { offsetMs } = useReplayState(controller)
  return (
    <div className="timecode" aria-label="Playhead time">
      {lead && <div className="timecode-lead">{lead}</div>}
      <span className="timecode-label">Playhead</span>
      <span className="timecode-value">{clock ? formatTimecode(clock.utcMs, clock.fps) : '--:--:--:--'}</span>
      <span className="timecode-sub">
        {clock ? `live position ${formatClock(clock.utcMs + offsetMs)}` : 'waiting for the replay'}
      </span>
    </div>
  )
}

// A scrub-bar end: how far back it is, and the clock time it stands for.
function ScrubEnd({ controller, back, label }: { controller: ReplayController; back: number; label: string }) {
  const clock = useClock(controller, 250)
  const { offsetMs } = useReplayState(controller)
  return (
    <span className="scrub-end">
      {label}
      <small>{clock ? formatClock(clock.utcMs + offsetMs - back) : ''}</small>
    </span>
  )
}

/** The transport box: jump back, scrub, back to live, and whatever the caller puts at its end (Take). */
export function Transport({ controller, children }: { controller: ReplayController; children?: ReactNode }) {
  const { offsetMs } = useReplayState(controller)
  const live = offsetMs === 0
  return (
    <>
      <section className="transport" aria-label="Transport">
        <button onClick={() => controller.jumpBack(JUMP_MS)} disabled={offsetMs >= WINDOW_MS}>
          Jump back 10 s
        </button>
        <div className="scrub">
          <ScrubEnd controller={controller} back={WINDOW_MS} label={`-${WINDOW_MS / 1000} s`} />
          <input
            type="range"
            min={0}
            max={WINDOW_MS}
            step={40}
            value={WINDOW_MS - offsetMs}
            onChange={(e) => controller.setOffset(WINDOW_MS - Number(e.target.value))}
            aria-label="Position in the last 10 seconds"
          />
          <ScrubEnd controller={controller} back={0} label="Live" />
        </div>
        <output className={live ? 'pos pos-live' : 'pos pos-replay'}>
          {live ? 'LIVE' : `-${(offsetMs / 1000).toFixed(1)} s`}
        </output>
        <button className="primary" onClick={() => controller.goLive()} disabled={live}>
          Back to live
        </button>
        {children}
      </section>
    </>
  )
}
