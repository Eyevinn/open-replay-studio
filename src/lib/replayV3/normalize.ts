import type { AngleView, CommandResult, EndAction, Frame, Instant, ReplayView, Readiness, TimeDomain } from './types'

// The only place that reads Strom's JSON. Field names follow the v3 definition (sections 2 to 6 and 8 of the doc):
// motion.{speed, live, cue, ramp, cursor{at, frame}}, range.{start, live_edge, live_edge_estimate, end}, on_air.*,
// grid.{source, output}.frame_ns, angles[], ready, time_domain, live_margin_ms, follow_live, jog_grid. Anything that is
// missing or of the wrong kind becomes null. Check the names against Strom's REPLAY_API.md / openapi.json when they
// are published.

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

/** `t` is a decimal string on the wire; accept a number too in case a field arrives that way. */
export function instant(v: unknown): Instant | null {
  const o = obj(v)
  if (!o) return null
  const t = typeof o['t'] === 'string' ? o['t'] : typeof o['t'] === 'number' ? String(Math.trunc(o['t'])) : null
  if (t === null || !/^-?\d+$/.test(t)) return null
  return { t, utc: str(o['utc']) }
}

export function frame(v: unknown): Frame | null {
  const o = obj(v)
  if (!o) return null
  return { frameInSecond: num(o['frame_in_second']), utc: str(o['utc']) }
}

const endAction = (v: unknown): EndAction => (v === 'loop' || v === 'live' ? v : 'freeze')
const readiness = (v: unknown): Readiness | null => (v === 'indexing' || v === 'warming' || v === 'ready' ? v : null)

export function motion(v: unknown): ReplayView['motion'] {
  const o = obj(v)
  const cue = obj(o?.['cue'])
  const cueIn = instant(cue?.['in'])
  const cueOut = instant(cue?.['out'])
  const cursor = obj(o?.['cursor'])
  const at = instant(cursor?.['at'])
  return {
    speed: num(o?.['speed']),
    live: bool(o?.['live']),
    cue: cueIn && cueOut ? { in: cueIn, out: cueOut, endAction: endAction(cue?.['end_action']) } : null,
    ramping: obj(o?.['ramp']) !== null,
    cursor: at ? { at, frame: frame(cursor?.['frame']) } : null,
  }
}

function angle(v: unknown): AngleView | null {
  const o = obj(v)
  if (!o) return null
  const block = str(o['block'])
  if (block === null) return null
  return {
    block,
    name: str(o['name']) ?? block,
    sourceId: str(o['source_id']),
    ready: readiness(o['ready']),
    offsetMs: num(o['offset_ms']),
    frameRateMissing: o['frame_rate_missing'] === true,
  }
}

/** Strom's state (REST body, or the WebSocket message) as the studio's view, with `connected` left for the client to set. */
export function view(raw: unknown): Omit<ReplayView, 'connected'> {
  const o = obj(raw) ?? {}
  const range = obj(o['range'])
  const onAir = obj(o['on_air'])
  const grid = obj(o['grid'])
  const margin = obj(o['live_margin'])
  const domain = str(o['time_domain'])
  return {
    timeDomain: domain === 'tai' || domain === 'unanchored' || domain === 'unknown' ? (domain as TimeDomain) : null,
    ready: readiness(o['ready']),
    angles: Array.isArray(o['angles']) ? (o['angles'].map(angle).filter(Boolean) as AngleView[]) : [],
    motion: motion(o['motion']),
    range: { start: instant(range?.['start']), liveEdge: instant(range?.['live_edge']), liveEdgeEstimate: instant(range?.['live_edge_estimate']), end: instant(range?.['end']) },
    onAir: { behindLiveMs: num(onAir?.['behind_live_ms']), behindLiveEstimateMs: num(onAir?.['behind_live_estimate_ms']), ageMs: num(onAir?.['age_ms']) },
    grid: { outputFrameNs: num(obj(grid?.['output'])?.['frame_ns']), sourceFrameNs: num(obj(grid?.['source'])?.['frame_ns']) },
    followLive: bool(o['follow_live']),
    jogGrid: o['jog_grid'] === 'output' ? 'output' : o['jog_grid'] === 'source' ? 'source' : null,
    liveMargin: { ms: num(margin?.['ms']) ?? num(o['live_margin_ms']), source: margin?.['source'] === 'set' ? 'set' : margin?.['source'] === 'computed' ? 'computed' : null },
  }
}

/** The reply to a command: the group's motion afterwards, our client_ref, and for `mark` the stamped moment. */
export function result(raw: unknown): CommandResult {
  const o = obj(raw) ?? {}
  const mark = obj(o['mark'])
  const at = instant(mark?.['at'])
  return {
    motion: o['motion'] !== undefined ? motion(o['motion']) : null,
    clientRef: str(o['client_ref']),
    mark: at ? { at, frame: frame(mark?.['frame']) } : null,
  }
}

export const errorOf = (raw: unknown): { code: string; details: string } | null => {
  const o = obj(raw)
  const e = o?.['error']
  return typeof e === 'string' ? { code: e, details: str(o?.['details']) ?? '' } : null
}
