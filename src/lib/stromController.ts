import { WINDOW_MS, type Clock, type ReplayController, type ReplayState } from './controller'
import { OffsetTracker } from './offset'

// Controller over a Strom replay group's WebSocket (`/api/replay/{flow}/{group}/ws`).
// Strom speaks in frames: it pushes `state` every ~50 ms and takes `seek`, `seek_rel`,
// `play` and `live` commands. The Studio speaks in "ms behind live", so this maps one to
// the other. "Live" for Strom is 1x at the live edge minus a margin, so the margin is
// subtracted: offset 0 means "at the live position", not "at the very last frame".
// This stands in for the Open Replay backend until its API exists.

// How far behind the live edge `live` parks the cursor comes from the Open Replay API (`liveMarginMs` in the playback
// status), which also uses it when it starts a replay. It is a buffer against segments arriving late: with 1 s segments,
// about 1000 ms was clean and 500 stuttered; with 500 ms segments, 800 was clean (see README, "Live margin").
const RECONNECT_MS = 2000
// Live or replay is decided by what the operator last asked for, not by the measured offset,
// so measurement noise can't flip it. Strom's state only overrules the mode when it clearly
// disagrees (someone else moved the group), and only once a command has had time to land.
const SETTLE_MS = 800
const LEAVE_LIVE_MS = 3000
const ENTER_LIVE_MS = 400

type StromState = {
  speed: number
  frame: number
  start_frame: number
  live_frame: number
  frame_ns: number
  /** The cursor frame's time, as Strom formats it (`utc` is RFC 3339). */
  cursor?: { utc?: string }
}

export type StromOptions = {
  /** Strom base URL, e.g. http://localhost:8080 */
  stromUrl: string
  /** Replay group of the flow's media players. */
  group: string
  /** Full WebSocket URL; skips finding the flow by group. */
  wsUrl?: string
  /** How far behind the live edge `live` parks the cursor, in ms. */
  liveMarginMs: number
}

export class StromController implements ReplayController {
  private state: ReplayState = { offsetMs: 0, connected: false }
  private listeners = new Set<(s: ReplayState) => void>()
  private ws: WebSocket | null = null
  private last: StromState | null = null
  private tracker: OffsetTracker
  private mode: 'live' | 'replay' = 'live'
  private target = 0 // offset the operator asked for, shown until the command has settled
  private settleUntil = 0
  private clockAnchor: { utcMs: number; at: number; speed: number; fps: number } | null = null
  private seq = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private closed = false
  private greeted = false

  constructor(private opts: StromOptions) {
    this.tracker = new OffsetTracker(opts.liveMarginMs)
    void this.connect()
  }

  getState() {
    return this.state
  }

  subscribe(listener: (s: ReplayState) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setOffset(ms: number) {
    const s = this.last
    const edge = this.tracker.edgeFrame()
    if (!s || edge === null || s.frame_ns <= 0) return
    const offset = Math.min(WINDOW_MS, Math.max(0, Math.round(ms)))
    if (offset === 0) return this.goLive()
    // Seek from the smoothed edge, so the offset shown afterwards is the one asked for.
    const behindFrames = ((this.opts.liveMarginMs + offset) * 1e6) / s.frame_ns
    this.send({ cmd: 'seek', frame: Math.round(edge - behindFrames) })
    this.ensurePlaying()
    this.command('replay', offset)
  }

  jumpBack(ms: number) {
    this.setOffset(this.state.offsetMs + ms)
  }

  goLive() {
    this.send({ cmd: 'live', margin_ms: this.opts.liveMarginMs })
    this.command('live', 0)
  }

  clock(): Clock | null {
    const a = this.clockAnchor
    if (!a) return null
    // Between state messages the playhead keeps moving at the playing speed.
    return { utcMs: a.utcMs + (performance.now() - a.at) * a.speed, fps: a.fps }
  }

  dispose() {
    this.closed = true
    clearTimeout(this.timer)
    this.ws?.close()
  }

  // Show what was asked for straight away and hold it until Strom's state has caught up.
  private command(mode: 'live' | 'replay', offsetMs: number) {
    this.mode = mode
    this.target = offsetMs
    this.settleUntil = performance.now() + SETTLE_MS
    this.publish({ offsetMs, connected: this.state.connected })
  }

  // A seek keeps the speed, so a paused group (a fresh flow starts paused) needs a play.
  private ensurePlaying() {
    if (this.last && this.last.speed !== 1) this.send({ cmd: 'play' })
  }

  private send(cmd: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ ...cmd, seq: ++this.seq }))
  }

  private async wsUrl(): Promise<string> {
    if (this.opts.wsUrl) return this.opts.wsUrl
    const base = this.opts.stromUrl.replace(/\/+$/, '')
    const res = await fetch(`${base}/api/flows`)
    if (!res.ok) throw new Error(`flows ${res.status}`)
    const body = (await res.json()) as { flows?: Flow[] } | Flow[]
    const flows = Array.isArray(body) ? body : (body.flows ?? [])
    const flow = flows.find((f) => f.blocks?.some((b) => b.properties?.['group'] === this.opts.group || b.properties?.['replay_group'] === this.opts.group))
    if (!flow) throw new Error(`no flow with replay group "${this.opts.group}"`)
    return `${base.replace(/^http/, 'ws')}/api/replay/${flow.id}/${encodeURIComponent(this.opts.group)}/ws`
  }

  private async connect() {
    if (this.closed) return
    try {
      const ws = new WebSocket(await this.wsUrl())
      this.ws = ws
      ws.onmessage = (m) => this.onMessage(m.data as string)
      ws.onclose = () => this.retry()
      ws.onerror = () => ws.close()
    } catch {
      this.retry()
    }
  }

  private retry() {
    this.last = null
    this.clockAnchor = null
    this.tracker = new OffsetTracker(this.opts.liveMarginMs)
    this.greeted = false
    this.publish({ offsetMs: this.state.offsetMs, connected: false })
    if (this.closed) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.connect(), RECONNECT_MS)
  }

  private onMessage(raw: string) {
    let msg: { type?: string } & Partial<StromState>
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.type !== 'state' || msg.frame_ns === undefined) return
    const s = msg as StromState
    this.last = s
    const utcMs = s.cursor?.utc ? Date.parse(s.cursor.utc) : NaN
    if (!Number.isNaN(utcMs)) {
      this.clockAnchor = { utcMs, at: performance.now(), speed: s.speed, fps: Math.round(1e9 / s.frame_ns) }
    }
    this.tracker.update({ atMs: performance.now(), frame: s.frame, liveFrame: s.live_frame, frameMs: s.frame_ns / 1e6 })
    // A fresh flow starts paused at the start of the group: go to live once.
    if (!this.greeted) {
      this.greeted = true
      if (s.speed === 0) this.goLive()
    }
    const measured = this.tracker.offsetMs()
    if (performance.now() < this.settleUntil) {
      this.publish({ offsetMs: this.target, connected: true })
      return
    }
    if (this.mode === 'live' && measured > LEAVE_LIVE_MS) this.mode = 'replay'
    else if (this.mode === 'replay' && measured < ENTER_LIVE_MS) this.mode = 'live'
    // In replay the offset only changes when the operator moves it, so 100 ms steps are plenty.
    this.publish({ offsetMs: this.mode === 'live' ? 0 : Math.round(measured / 100) * 100, connected: true })
  }

  private publish(next: ReplayState) {
    if (next.offsetMs === this.state.offsetMs && next.connected === this.state.connected) return
    this.state = next
    this.listeners.forEach((l) => l(next))
  }
}

type Flow = { id: string; blocks?: Array<{ properties?: Record<string, unknown> }> }
