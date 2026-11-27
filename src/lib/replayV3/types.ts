// Strom's replay API, version 3 of the proposal ("Förslag: städat replay-API", tab "Version 3 (gäller)", decided
// 2026-11-27). Written from that document, not from Strom's own docs/REPLAY_API.md or openapi.json, which are not
// published yet: when they are, check every field name below against them. All parsing of Strom's JSON is in
// normalize.ts, so a wrong name is fixed in one place.

/** Nanoseconds on the group's time axis, always a decimal string on the wire. Read it with BigInt. */
export type Ns = string

/** An exact point in time. `utc` is present only when the axis is TAI. */
export interface Instant {
  t: Ns
  utc: string | null
}

/** The frame on the output grid that holds a time, for the timecode HH:MM:SS:FF. Null until the grid is known. */
export interface Frame {
  frameInSecond: number | null
  utc: string | null
}

/** A time in a command: exactly one field. */
export type Target = { t: Ns } | { utc: string } | { from_live_ms: number } | { rel_ms: number }

export type EndAction = 'freeze' | 'loop' | 'live'

export type Command =
  | { cmd: 'seek'; to: Target; speed?: number }
  | { cmd: 'jog'; frames: number }
  | { cmd: 'speed'; speed: number }
  | { cmd: 'play'; speed?: number; until?: Target; end_action?: EndAction }
  | { cmd: 'pause' }
  | { cmd: 'ramp'; to: number; duration_ms: number }
  | { cmd: 'cue'; in: Target; out: Target; end_action?: EndAction }
  | { cmd: 'uncue' }
  | { cmd: 'live'; margin_ms?: number }
  | { cmd: 'end' }
  | { cmd: 'mark'; label?: string; at?: Target }
  | { cmd: 'follow_live'; on: boolean }

export type TimeDomain = 'tai' | 'unanchored' | 'unknown'
export type Readiness = 'indexing' | 'warming' | 'ready'

export interface AngleView {
  block: string
  name: string
  /** The source's own id, for a TAMS source its flow id. */
  sourceId: string | null
  ready: Readiness | null
  /** Trim on the group's axis, ms, positive is later. */
  offsetMs: number | null
  frameRateMissing: boolean
}

/** What the studio shows, whatever Strom's JSON looked like. Unknown is null, never 0. */
export interface ReplayView {
  connected: boolean
  timeDomain: TimeDomain | null
  ready: Readiness | null
  angles: AngleView[]
  motion: {
    speed: number | null
    live: boolean | null
    cue: { in: Instant; out: Instant; endAction: EndAction } | null
    ramping: boolean
    cursor: { at: Instant; frame: Frame | null } | null
  }
  range: { start: Instant | null; liveEdge: Instant | null; liveEdgeEstimate: Instant | null; end: Instant | null }
  onAir: { behindLiveMs: number | null; behindLiveEstimateMs: number | null; ageMs: number | null }
  grid: { outputFrameNs: number | null; sourceFrameNs: number | null }
  followLive: boolean | null
  jogGrid: 'source' | 'output' | null
  liveMargin: { ms: number | null; source: 'computed' | 'set' | null }
}

/** The result of a command: the group's motion afterwards, and for `mark` the stamped moment. */
export interface CommandResult {
  motion: ReplayView['motion'] | null
  clientRef: string | null
  mark: { at: Instant; frame: Frame | null } | null
}

/** Something that happened in the group, with the reason. `own` is true when our command caused it. */
export interface ReplayEvent {
  seq: number | null
  type: string
  cause: string | null
  clientRef: string | null
  own: boolean
  at: number
  raw: unknown
}

export class ReplayCommandError extends Error {
  constructor(
    message: string,
    /** `invalid`, `conflict`, `out_of_range` or `timeout`. */
    readonly code: string,
  ) {
    super(message)
    this.name = 'ReplayCommandError'
  }
}
