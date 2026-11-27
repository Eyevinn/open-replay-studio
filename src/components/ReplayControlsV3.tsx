import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { actions, useData } from '../state/store'
import { diffMs, epochMs, lengthOf, timecodeOf, clockOf } from '../lib/replayV3/ns'
import { ReplayCommandError, type Command, type EndAction, type Instant, type ReplayEvent, type ReplayView } from '../lib/replayV3/types'
import type { ReplayV3Client } from '../lib/replayV3/client'
import { useReplayEvents, useReplayView } from '../lib/replayV3/useReplayV3'

const SPEEDS = [0.25, 0.5, 0.75, 1] as const
const WINDOWS = [
  { label: '10 s', ms: 10_000 },
  { label: '1 min', ms: 60_000 },
  { label: '10 min', ms: 600_000 },
] as const

const behindMs = (v: ReplayView) => (v.motion.live === true ? 0 : (v.onAir.behindLiveEstimateMs ?? v.onAir.behindLiveMs))

/** The playhead box: the timecode on the output grid, how far behind live, and whether the replay is ready. */
export function TimecodeV3({ client, lead }: { client: ReplayV3Client; lead?: ReactNode }) {
  const view = useReplayView(client)
  const cursor = view.motion.cursor
  const behind = behindMs(view)
  return (
    <div className="timecode" aria-label="Playhead time">
      {lead && <div className="timecode-lead">{lead}</div>}
      <span className="timecode-label">Playhead</span>
      <span className="timecode-value">{cursor ? timecodeOf(cursor.frame, cursor.at) : '--:--:--:--'}</span>
      <span className="timecode-sub">
        {view.ready !== null && view.ready !== 'ready' ? `${view.ready}…` : behind === null ? 'waiting for the replay' : view.motion.live ? 'live' : `${lengthOf(behind)} behind live`}
      </span>
    </div>
  )
}

/** The connection, live and readiness chips for the lead of the playhead box. */
export function StatusChipsV3({ client }: { client: ReplayV3Client }) {
  const view = useReplayView(client)
  return (
    <div className="status">
      <span className={view.connected ? 'chip chip-ok' : 'chip'}>{view.connected ? 'Connected' : 'Offline'}</span>
      <span className={view.motion.live ? 'chip' : 'chip chip-replay'}>{view.motion.live ? 'Live' : 'Replay'}</span>
      {view.ready !== null && view.ready !== 'ready' && <span className="chip chip-warn">{view.ready}</span>}
    </div>
  )
}

const causeText: Record<string, string> = {
  cue_end: 'the clip ended',
  caught_up: 'caught up with live',
  edge_moved: 'the live edge moved ahead',
  media_end: 'the media ended',
  retention: 'old media was removed',
  media: 'the media changed',
  start_mode: 'the group started',
}
function describeEvent(e: ReplayEvent): string {
  const why = e.cause ? (causeText[e.cause] ?? e.cause) : ''
  const who = e.own ? 'you' : e.clientRef ? 'someone else' : 'Strom'
  if (e.type === 'lagged') return 'Missed events: state was read again'
  if (e.type === 'missed') return 'Events were missed'
  return `${e.type}${why ? `: ${why}` : ''} (${who})`
}

/**
 * The replay controls: live, play, pause, speed, jog, jump and scrub; mark, in, out, cue and play a clip; follow
 * live, margin and readiness; and what Strom says happened. Keys: space plays or pauses, L goes live, left and right
 * jog (shift for five), I and O set in and out, C cues, M marks.
 */
export function ControlsV3({ client, groupId, programStreamId, addTo, children }: { client: ReplayV3Client; groupId: string; programStreamId: string; /** The playlist "Save clip and add" appends to. */ addTo?: { id: string; name: string } | null; children?: ReactNode }) {
  const view = useReplayView(client)
  const events = useReplayEvents(client)
  const { settings } = useData()
  const [error, setError] = useState('')
  const [windowMs, setWindowMs] = useState<number>(60_000)
  const [clipSpeed, setClipSpeed] = useState<number>(0.5)
  // From live a slower speed would catch live again at once (follow live), so a slow replay starts this far back.
  const [backMs, setBackMs] = useState<number>(8000)
  const [endAction, setEndAction] = useState<EndAction>('freeze')
  const [inAt, setInAt] = useState<Instant | null>(null)
  const [outAt, setOutAt] = useState<Instant | null>(null)
  const [label, setLabel] = useState('')
  const [marginText, setMarginText] = useState('')
  const [showEvents, setShowEvents] = useState(false)
  const [notice, setNotice] = useState('')

  const run = useCallback(
    async (cmd: Command) => {
      setError('')
      try {
        return await client.send(cmd)
      } catch (e) {
        setError(e instanceof ReplayCommandError ? `${e.code === 'out_of_range' ? 'Outside the recording' : e.code === 'conflict' ? 'Not possible now' : e.code === 'timeout' ? 'No answer' : 'Not accepted'}: ${e.message}` : String(e))
        return null
      }
    },
    [client],
  )

  const cursor = view.motion.cursor
  const speed = view.motion.speed
  const setSpeed = useCallback(
    (s: number) => {
      // Live and slower than live: replay from a moment back, since the live point itself has nothing to play slowly.
      if (view.motion.live === true && s < 1) return void run({ cmd: 'seek', to: { from_live_ms: backMs }, speed: s })
      return void run(view.motion.speed !== null && view.motion.speed !== 0 ? { cmd: 'speed', speed: s } : { cmd: 'play', speed: s })
    },
    [view.motion.live, view.motion.speed, backMs, run],
  )
  const playing = speed !== null && speed !== 0
  const inOutLength = inAt && outAt ? diffMs(outAt.t, inAt.t) : null
  const canCue = inAt !== null && outAt !== null && inOutLength !== null && inOutLength > 0

  const mark = useCallback(
    async (at?: { rel_ms: number }, name?: string) => {
      const r = await run({ cmd: 'mark', ...(label.trim() ? { label: label.trim() } : {}), ...(at ? { at } : {}) })
      if (!r) return
      if (!r.mark) return setError('Strom did not say where the mark is.')
      actions.addMark({ groupId, name: name ?? (label.trim() || 'Mark'), at: epochMs(r.mark.at), t: r.mark.at.t, tag: null })
      setNotice(`Marked ${clockOf(r.mark.at)}`)
      setLabel('')
    },
    [groupId, label, run],
  )

  const setIn = useCallback(() => {
    if (cursor) setInAt(cursor.at)
  }, [cursor])
  const setOut = useCallback(() => {
    if (cursor) setOutAt(cursor.at)
  }, [cursor])
  const cue = useCallback(async () => {
    if (!inAt || !outAt) return null
    return run({ cmd: 'cue', in: { t: inAt.t }, out: { t: outAt.t }, end_action: endAction })
  }, [inAt, outAt, endAction, run])
  const playClip = useCallback(async () => {
    if (!view.motion.cue && !(await cue())) return
    await run({ cmd: 'play', speed: clipSpeed })
  }, [view.motion.cue, cue, run, clipSpeed])
  const saveClip = useCallback((toPlaylist = false) => {
    if (!inAt || !outAt || !canCue) return
    if (!programStreamId) return setError('No source is on air to save the clip from.')
    const clipId = actions.addClip({
      groupId,
      name: label.trim() || 'Clip',
      streamId: programStreamId,
      at: epochMs(inAt),
      durationMs: diffMs(outAt.t, inAt.t),
      speed: clipSpeed >= 0.25 && clipSpeed <= 1 ? clipSpeed : 1,
      tag: null,
      starred: false,
      inT: inAt.t,
      outT: outAt.t,
    })
    if (toPlaylist && addTo) actions.addItem(addTo.id, clipId)
    setNotice(`Saved a clip of ${lengthOf(inOutLength ?? 0)}${toPlaylist && addTo ? ` and added it to ${addTo.name}` : ''}`)
    setLabel('')
  }, [inAt, outAt, canCue, groupId, label, programStreamId, clipSpeed, inOutLength, addTo])

  // The scrub bar shows how far behind live the playhead is within the chosen window; dragging seeks, and the far end is live.
  const behind = behindMs(view)
  const [drag, setDrag] = useState<number | null>(null)
  const dragTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const shown = drag ?? (behind === null ? 0 : Math.min(windowMs, behind))
  const onScrub = (value: number) => {
    const offset = windowMs - value
    setDrag(offset)
    clearTimeout(dragTimer.current)
    dragTimer.current = setTimeout(() => {
      void (offset <= 0 ? run({ cmd: 'live' }) : run({ cmd: 'seek', to: { from_live_ms: offset } }))
      setTimeout(() => setDrag(null), 400)
    }, 90)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ') {
        e.preventDefault()
        void run(playing ? { cmd: 'pause' } : { cmd: 'play' })
      } else if (e.key === 'l' || e.key === 'L') void run({ cmd: 'live' })
      else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        void run({ cmd: 'jog', frames: e.shiftKey ? -5 : -1 })
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        void run({ cmd: 'jog', frames: e.shiftKey ? 5 : 1 })
      } else if (e.key === 'i' || e.key === 'I') setIn()
      else if (e.key === 'o' || e.key === 'O') setOut()
      else if (e.key === 'c' || e.key === 'C') void cue()
      else if (e.key === 'm' || e.key === 'M') void mark()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, run, setIn, setOut, cue, mark])

  const margin = view.liveMargin
  const tagNames = settings.markTags

  return (
    <div className="controls-v3" aria-label="Replay controls">
      <section className="transport ctl-box">
        <div className="ctl-rows">
          <div className="ctl-row">
            <button className={view.motion.live ? 'primary on' : 'primary'} onClick={() => void run({ cmd: 'live' })} title="Play from the live edge (L)">
              Live
            </button>
            <span className="ctl-group" aria-label="Jump">
              {[-10_000, -5_000, -1_000, 1_000].map((ms) => (
                <button key={ms} onClick={() => void run({ cmd: 'seek', to: { rel_ms: ms } })} title={`Jump ${ms < 0 ? 'back' : 'forward'} ${Math.abs(ms) / 1000} s`}>
                  {ms < 0 ? '−' : '+'}
                  {Math.abs(ms) / 1000} s
                </button>
              ))}
            </span>
            <span className="ctl-group" aria-label="Frame step">
              <button onClick={() => void run({ cmd: 'jog', frames: -1 })} title="One frame back (left arrow)" aria-label="One frame back">
                ‹
              </button>
              <button className={playing ? 'on' : ''} onClick={() => void run(playing ? { cmd: 'pause' } : { cmd: 'play' })} title="Play or pause (space)">
                {playing ? 'Pause' : 'Play'}
              </button>
              <button onClick={() => void run({ cmd: 'jog', frames: 1 })} title="One frame forward (right arrow)" aria-label="One frame forward">
                ›
              </button>
            </span>
            <label className="field-inline" title="When live, slow motion starts this far back">
              <span className="sr-only">Slow motion starts</span>
              <select value={backMs} onChange={(e) => setBackMs(Number(e.target.value))} aria-label="Slow motion starts this far back">
                {[4000, 8000, 15000].map((ms) => (
                  <option key={ms} value={ms}>
                    {ms / 1000} s back
                  </option>
                ))}
              </select>
            </label>
            <span className="ctl-group" aria-label="Speed">
              {SPEEDS.map((s) => (
                <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)} title={`Play at ${s * 100} %${view.motion.live ? `, starting ${backMs / 1000} s back` : ''}`}>
                  {s * 100}%
                </button>
              ))}
            </span>
          </div>

          <div className="ctl-row ctl-scrub">
            <label className="field-inline">
              <span className="sr-only">Scrub window</span>
              <select value={windowMs} onChange={(e) => setWindowMs(Number(e.target.value))} aria-label="Scrub window">
                {WINDOWS.map((w) => (
                  <option key={w.ms} value={w.ms}>
                    Last {w.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="scrub">
              <span className="scrub-end">−{WINDOWS.find((w) => w.ms === windowMs)?.label}</span>
              <input type="range" min={0} max={windowMs} step={Math.max(40, windowMs / 500)} value={windowMs - shown} onChange={(e) => onScrub(Number(e.target.value))} aria-label={`Position in the last ${WINDOWS.find((w) => w.ms === windowMs)?.label}`} />
              <span className="scrub-end">Live</span>
            </div>
            <output className={view.motion.live ? 'pos pos-live' : 'pos pos-replay'}>{view.motion.live ? 'LIVE' : behind === null ? '--' : `−${lengthOf(behind)}`}</output>
          </div>

          <div className="ctl-row">
            <span className="ctl-group" aria-label="Marks">
              <input type="text" className="ctl-label" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label for a mark or clip" />
              <button onClick={() => void mark()} title="Mark what is playing now (M)">
                Mark
              </button>
              <button onClick={() => void mark({ rel_ms: -8000 }, label.trim() || 'Mark −8 s')} title="Mark eight seconds earlier">
                Mark −8 s
              </button>
              {tagNames.slice(0, 4).map((t) => (
                <button key={t} className="ghost" onClick={() => void mark(undefined, t)} title={`Mark as ${t}`}>
                  {t}
                </button>
              ))}
            </span>
            <span className="ctl-group" aria-label="Clip">
              <button className={inAt ? 'on' : ''} onClick={setIn} title="Set in at the playhead (I)">
                In{inAt ? ` ${clockOf(inAt).slice(0, 8)}` : ''}
              </button>
              <button className={outAt ? 'on' : ''} onClick={setOut} title="Set out at the playhead (O)">
                Out{outAt ? ` ${clockOf(outAt).slice(0, 8)}` : ''}
              </button>
              <span className="muted small">{inOutLength === null ? '' : inOutLength > 0 ? lengthOf(inOutLength) : 'out is before in'}</span>
              <select value={endAction} onChange={(e) => setEndAction(e.target.value as EndAction)} aria-label="When the clip ends">
                <option value="freeze">Freeze at the end</option>
                <option value="loop">Loop</option>
                <option value="live">Go live</option>
              </select>
              <select value={clipSpeed} onChange={(e) => setClipSpeed(Number(e.target.value))} aria-label="Clip speed">
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s * 100} %
                  </option>
                ))}
              </select>
              <button disabled={!canCue} onClick={() => void cue()} title="Hold the clip and park on its in (C)">
                Cue
              </button>
              <button className="primary" disabled={!canCue && !view.motion.cue} onClick={() => void playClip()}>
                Play clip
              </button>
              <button disabled={!view.motion.cue} onClick={() => void run({ cmd: 'uncue' })}>
                Release
              </button>
              <button disabled={!canCue} onClick={() => saveClip()} title="Keep this clip in the library">
                Save clip
              </button>
              {addTo && (
                <button disabled={!canCue} onClick={() => saveClip(true)} title={`Keep this clip and add it to ${addTo.name}`}>
                  Save and add
                </button>
              )}
            </span>
          </div>

          <div className="ctl-row ctl-status">
            <label className="check" title="When off, the replay never goes live by itself: it stays where you put it">
              <input type="checkbox" checked={view.followLive === true} onChange={(e) => void run({ cmd: 'follow_live', on: e.target.checked })} /> Follow live
            </label>
            <span className="muted small" title="How far behind the live edge Live plays">
              Live margin {margin.ms === null ? '--' : `${margin.ms} ms`}
              {margin.source ? ` (${margin.source})` : ''}
            </span>
            <label className="field-inline">
              <span className="sr-only">Set the live margin</span>
              <input type="number" className="ctl-margin" min={0} max={10000} step={100} placeholder="ms" value={marginText} onChange={(e) => setMarginText(e.target.value)} aria-label="Live margin in ms" />
            </label>
            <button
              disabled={marginText === '' || !Number.isFinite(Number(marginText))}
              onClick={() => {
                void run({ cmd: 'live', margin_ms: Number(marginText) })
                setMarginText('')
              }}
              title="Set the margin and go live"
            >
              Set and go live
            </button>
            {view.motion.cue && <span className="pill pill-accent">Clip {lengthOf(diffMs(view.motion.cue.out.t, view.motion.cue.in.t))} · {view.motion.cue.endAction}</span>}
            {view.motion.ramping && <span className="pill">ramping</span>}
            {view.angles.some((a) => a.offsetMs) && (
              <span className="muted small" title="Trim set on the angles">
                Trim: {view.angles.filter((a) => a.offsetMs).map((a) => `${a.name} ${a.offsetMs! > 0 ? '+' : ''}${a.offsetMs} ms`).join(', ')}
              </span>
            )}
            <button className="ghost" onClick={() => setShowEvents((s) => !s)} aria-expanded={showEvents}>
              Events {events.length > 0 ? `(${events.length})` : ''}
            </button>
          </div>

          {(error || notice) && (
            <div className="ctl-row">
              {error ? (
                <span className="error" role="alert">
                  {error}
                </span>
              ) : (
                <span className="muted small" role="status">
                  {notice}
                </span>
              )}
            </div>
          )}
          {showEvents && (
            <ul className="ctl-events" aria-label="Events">
              {events.length === 0 && <li className="muted small">Nothing has happened yet.</li>}
              {events.slice(0, 12).map((e, i) => (
                <li key={`${e.seq ?? 'x'}-${i}`} className="small">
                  <span className="muted">{new Date(e.at).toLocaleTimeString('sv-SE')}</span> {describeEvent(e)}
                </li>
              ))}
            </ul>
          )}
        </div>
        {children}
      </section>
    </div>
  )
}
