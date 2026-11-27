import { describe, expect, it } from 'vitest'
import { errorOf, instant, result, view } from './normalize'

// The shape the deployed Strom answers with (replay API, api_version 2).
const state = {
  ready: 'ready',
  time_domain: 'tai',
  follow_live: true,
  live_margin: { ms: 800, source: 'set' },
  motion: {
    speed: 1,
    live: true,
    cue: null,
    ramp: null,
    cursor: { at: { t: '1795788596713081751', utc: '2026-11-27T14:09:19.713Z' }, frame: { frame_in_second: 17, utc: '2026-11-27T14:09:19.681Z' } },
  },
  range: { start: { t: '1', utc: null }, live_edge: { t: '9', utc: null }, growing: true },
  on_air: { behind_live_ms: 779 },
  grid: { output: { frame_ns: 40000000 }, source: { frame_ns: 40000000 } },
  angles: [{ block: 'cam1', name: null, source_id: 'flow-1', ready: 'ready', offset_ms: 0 }, { block: 'cam2', name: 'Camera 2', source_id: 'flow-2' }],
}

describe('reading Strom\'s state', () => {
  it('reads the motion, range, angles and margin', () => {
    const v = view(state)
    expect(v.timeDomain).toBe('tai')
    expect(v.ready).toBe('ready')
    expect(v.followLive).toBe(true)
    expect(v.motion).toMatchObject({ speed: 1, live: true, cue: null, ramping: false })
    expect(v.motion.cursor?.at.t).toBe('1795788596713081751')
    expect(v.motion.cursor?.frame?.frameInSecond).toBe(17)
    expect(v.range.liveEdge?.t).toBe('9')
    expect(v.onAir.behindLiveMs).toBe(779)
    expect(v.grid.outputFrameNs).toBe(40_000_000)
    expect(v.liveMargin).toEqual({ ms: 800, source: 'set' })
  })

  it('names an angle after its block when it has no name, and keeps its source id', () => {
    const [a, b] = view(state).angles
    expect(a).toMatchObject({ block: 'cam1', name: 'cam1', sourceId: 'flow-1' })
    expect(b).toMatchObject({ block: 'cam2', name: 'Camera 2', sourceId: 'flow-2', offsetMs: null })
  })

  it('reads a held cue with its end action, and defaults an unknown end action to freeze', () => {
    const cue = { in: { t: '10' }, out: { t: '20' }, end_action: 'loop' }
    expect(view({ motion: { speed: 0, cue } }).motion.cue).toMatchObject({ in: { t: '10' }, out: { t: '20' }, endAction: 'loop' })
    expect(view({ motion: { cue: { ...cue, end_action: 'nonsense' } } }).motion.cue?.endAction).toBe('freeze')
  })

  it('turns anything missing or of the wrong kind into null, never 0', () => {
    const v = view({ motion: { speed: 'fast' }, range: 5, angles: 'none' })
    expect(v.motion.speed).toBeNull()
    expect(v.motion.live).toBeNull()
    expect(v.range.liveEdge).toBeNull()
    expect(v.angles).toEqual([])
    expect(view(null).timeDomain).toBeNull()
  })

  it('takes a time only when it is an integer, as a string or a number', () => {
    expect(instant({ t: '123' })).toEqual({ t: '123', utc: null })
    expect(instant({ t: 123.9 })).toEqual({ t: '123', utc: null })
    expect(instant({ t: '1.5' })).toBeNull()
    expect(instant({ t: 'abc' })).toBeNull()
    expect(instant('123')).toBeNull()
  })
})

describe('reading a command result', () => {
  it('reads the motion afterwards, the client ref and a stamped mark', () => {
    const r = result({ motion: { speed: 0.5, live: false }, client_ref: 'c-1', mark: { at: { t: '77', utc: '2026-11-27T14:00:00.000Z' }, frame: { frame_in_second: 3 } } })
    expect(r.motion?.speed).toBe(0.5)
    expect(r.clientRef).toBe('c-1')
    expect(r.mark?.at.t).toBe('77')
    expect(r.mark?.frame?.frameInSecond).toBe(3)
  })

  it('has no motion or mark when the reply has none', () => {
    expect(result({})).toEqual({ motion: null, clientRef: null, mark: null })
  })

  it('reads an error as its code and details', () => {
    expect(errorOf({ error: 'out_of_range', details: 'outside the recording' })).toEqual({ code: 'out_of_range', details: 'outside the recording' })
    expect(errorOf({ error: 'invalid' })).toEqual({ code: 'invalid', details: '' })
    expect(errorOf({ motion: {} })).toBeNull()
  })
})
