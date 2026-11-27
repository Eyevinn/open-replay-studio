// A stand-in for Strom's replay API v3, built from the proposal ("Förslag: städat replay-API", Version 3), so the
// studio's controls can be exercised before Strom deploys it. It is a mock: it simulates one group over a TAI timeline
// with 500 ms segments, and mirrors what the doc says about commands, errors, events and state. Where the doc is
// silent, this guesses; check against Strom's REPLAY_API.md / openapi.json once they are published.
//
//   node scripts/mock-replay-v3.mjs [port]     (default 4010)
//
// Endpoints: GET /api/replay, GET /api/replay/:flow, GET /api/replay/:flow/:group[/state],
// POST /api/replay/:flow/:group/command, WebSocket /api/replay/:flow/:group/ws?state_ms=
import http from 'node:http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.argv[2] ?? 4010)
const MS = 1_000_000n
const TAI_OFFSET_NS = 37_000_000_000n // TAI is 37 s ahead of UTC
const STEP_MS = 500 // segment length: the live edge moves in these steps
const FRAME_NS = 40_000_000n // 25 fps output grid
const SOURCE_FRAME_NS = 16_666_667n // 60 fps source grid
const FLOW = 'mock'
const GROUP = 'mock'
const nowNs = () => BigInt(Date.now()) * MS + TAI_OFFSET_NS
const utcOf = (t) => new Date(Number((t - TAI_OFFSET_NS) / MS)).toISOString()
const inst = (t) => ({ t: t.toString(), utc: utcOf(t) })

const startedAt = Date.now()
const mediaStart = nowNs() - 15n * 60n * 1000n * MS
const g = {
  cursor: mediaStart, // start_mode paused: at range.start
  speed: 0,
  live: false,
  cue: null, // { in, out, endAction }
  ramp: null, // { from, to, startMs, durationMs }
  followLive: true,
  jogGrid: 'source',
  marginMs: null, // null = computed
  eventSeq: 0,
  offsets: [0, 0, 0],
}
const edge = () => {
  const n = nowNs() - 300n * MS
  const step = BigInt(STEP_MS) * MS
  return (n / step) * step
}
const edgeEstimate = () => nowNs() - 300n * MS
const margin = () => (g.marginMs !== null ? { ms: g.marginMs, source: 'set' } : { ms: 900, source: 'computed' }) // step + 400 ms, clamped 800-3000
const readiness = () => {
  const s = (Date.now() - startedAt) / 1000
  return s < 1.5 ? 'indexing' : s < 4 ? 'warming' : 'ready'
}
const angles = () => ['Camera 1', 'Camera 2', 'Camera 3'].map((name, i) => ({ block: `cam${i + 1}`, name, source_id: `mock-flow-${i + 1}`, ready: readiness(), offset_ms: g.offsets[i], frame_rate_missing: false }))

const clients = new Set()
function emit(type, cause, clientRef, extra = {}) {
  g.eventSeq++
  const msg = { type, event_seq: g.eventSeq, cause, ...(clientRef ? { client_ref: clientRef } : {}), ...extra }
  for (const c of clients) c.send(JSON.stringify(msg))
}

const motion = () => ({
  speed: g.speed,
  live: g.live,
  cue: g.cue ? { in: inst(g.cue.in), out: inst(g.cue.out), end_action: g.cue.endAction } : null,
  ramp: g.ramp ? { to: g.ramp.to, duration_ms: g.ramp.durationMs } : null,
  cursor: { at: inst(g.cursor), frame: { frame_in_second: Number(((g.cursor - TAI_OFFSET_NS) % 1_000_000_000n) / FRAME_NS), utc: utcOf(g.cursor - ((g.cursor - TAI_OFFSET_NS) % FRAME_NS)) } },
})
const state = () => {
  const e = edge()
  const est = edgeEstimate()
  return {
    ready: readiness(),
    time_domain: 'tai',
    motion: motion(),
    range: { start: inst(mediaStart), live_edge: inst(e), live_edge_estimate: inst(est), end: inst(e) },
    on_air: { behind_live_ms: Number((e - g.cursor) / MS), behind_live_estimate_ms: Number((est - g.cursor) / MS), age_ms: Number((nowNs() - e) / MS) },
    grid: { output: { frame_ns: Number(FRAME_NS) }, source: { frame_ns: Number(SOURCE_FRAME_NS) } },
    angles: angles(),
    follow_live: g.followLive,
    jog_grid: g.jogGrid,
    live_margin: margin(),
  }
}

class CmdError extends Error {
  constructor(code, details) {
    super(details)
    this.code = code
  }
}
const resolveTarget = (t) => {
  const keys = Object.keys(t ?? {})
  if (keys.length !== 1) throw new CmdError('invalid', 'A target has exactly one field.')
  const [k] = keys
  if (k === 't') return BigInt(t.t)
  if (k === 'utc') return BigInt(Date.parse(t.utc)) * MS + TAI_OFFSET_NS
  if (k === 'from_live_ms') return edge() - 1n - BigInt(Math.round(t.from_live_ms)) * MS
  if (k === 'rel_ms') return g.cursor + BigInt(Math.round(t.rel_ms)) * MS
  throw new CmdError('invalid', `Unknown target field ${k}.`)
}
const clamp = (t) => (t < mediaStart ? mediaStart : t > edge() - 1n ? edge() - 1n : t)
const goLive = (cause, ref, marginMs) => {
  if (marginMs !== undefined) g.marginMs = marginMs
  g.cursor = clamp(edge() - BigInt(margin().ms) * MS)
  g.speed = 1
  g.live = true
  g.cue = null
  g.ramp = null
  emit('live', cause, ref)
}

function run(cmd, ref) {
  switch (cmd.cmd) {
    case 'seek': {
      g.cursor = clamp(resolveTarget(cmd.to))
      if (cmd.speed !== undefined) g.speed = cmd.speed
      g.live = false
      emit('seek', 'seek', ref)
      break
    }
    case 'jog': {
      g.speed = 0
      g.live = false
      g.ramp = null
      const step = g.jogGrid === 'output' ? FRAME_NS : SOURCE_FRAME_NS
      g.cursor = clamp(g.cursor + BigInt(cmd.frames) * step)
      break
    }
    case 'speed':
      if (cmd.speed < -8 || cmd.speed > 8) throw new CmdError('invalid', 'speed is -8 to 8.')
      g.speed = cmd.speed
      g.live = false // the table in section 3.1: live is off, and comes back by itself when follow_live is on and it catches up
      g.ramp = null
      break
    case 'play': {
      g.speed = cmd.speed ?? 1
      g.live = false
      if (cmd.until) {
        const until = resolveTarget(cmd.until)
        g.cue = { in: g.cue && g.cue.in < g.cursor ? g.cue.in : g.cursor, out: until, endAction: cmd.end_action ?? 'freeze' }
      } else if (cmd.end_action && !g.cue) throw new CmdError('invalid', 'end_action needs until or a cue.')
      else if (g.cue && g.cursor >= g.cue.out - FRAME_NS / 2n) g.cursor = g.cue.in
      break
    }
    case 'pause':
      g.speed = 0
      g.live = false
      break
    case 'ramp':
      if (cmd.duration_ms < 0 || cmd.duration_ms > 60000) throw new CmdError('invalid', 'duration_ms is 0 to 60000.')
      g.live = false
      g.ramp = cmd.duration_ms === 0 ? null : { from: g.speed, to: cmd.to, startMs: Date.now(), durationMs: cmd.duration_ms }
      if (cmd.duration_ms === 0) g.speed = cmd.to
      break
    case 'cue': {
      const a = clamp(resolveTarget(cmd.in))
      const b = resolveTarget(cmd.out)
      if (b <= a) throw new CmdError('invalid', 'out must be after in.')
      if (b < mediaStart || a > edge()) throw new CmdError('out_of_range', 'The interval is outside the media.')
      g.cue = { in: a, out: b > edge() ? edge() : b, endAction: cmd.end_action ?? 'freeze' }
      g.cursor = a
      g.speed = 0
      g.live = false
      g.ramp = null
      break
    }
    case 'uncue':
      g.cue = null
      break
    case 'live':
      goLive('live', ref, cmd.margin_ms)
      break
    case 'end':
      g.cursor = clamp(edge())
      g.speed = 0
      g.live = false
      g.cue = null
      g.ramp = null
      break
    case 'mark': {
      const at = cmd.at ? resolveTarget(cmd.at) : g.cursor
      if (at < mediaStart || at > edge()) throw new CmdError('out_of_range', 'The mark is outside the media.')
      return { mark: { at: inst(at), frame: { frame_in_second: Number(((at - TAI_OFFSET_NS) % 1_000_000_000n) / FRAME_NS), utc: utcOf(at) }, angles: [] } }
    }
    case 'follow_live':
      g.followLive = !!cmd.on
      break
    default:
      throw new CmdError('invalid', `Unknown command ${cmd.cmd}.`)
  }
  return {}
}
const answer = (cmd, ref) => {
  if (cmd.client_ref !== undefined && (typeof cmd.client_ref !== 'string' || cmd.client_ref.length > 64)) throw new CmdError('invalid', 'client_ref is a string of at most 64 characters.')
  const extra = run(cmd, ref)
  return { motion: motion(), ...(ref ? { client_ref: ref } : {}), ...extra }
}

// The simulation: 50 ms ticks.
setInterval(() => {
  if (g.ramp) {
    const f = Math.min(1, (Date.now() - g.ramp.startMs) / g.ramp.durationMs)
    g.speed = g.ramp.from + (g.ramp.to - g.ramp.from) * f
    if (f >= 1) g.ramp = null
  }
  if (g.speed !== 0) g.cursor += BigInt(Math.round(g.speed * 50)) * MS
  const e = edge()
  if (g.cue && g.speed > 0 && g.cursor >= g.cue.out) {
    const a = g.cue.endAction
    if (a === 'loop') g.cursor = g.cue.in
    else if (a === 'live') goLive('cue_end', null)
    else {
      g.cursor = g.cue.out - FRAME_NS
      g.speed = 0
      emit('ended', 'cue_end', null)
    }
  } else if (g.cue && g.speed < 0 && g.cursor <= g.cue.in) {
    g.cursor = g.cue.in
    g.speed = 0
    emit('ended', 'cue_end', null)
  }
  if (!g.cue && g.followLive && g.speed > 0 && !g.live && g.cursor >= e - BigInt(margin().ms) * MS) {
    g.cursor = clamp(e - BigInt(margin().ms) * MS)
    g.speed = 1
    g.live = true
    g.ramp = null
    emit('live', 'caught_up', null)
  }
  if (g.cursor > e - 1n) g.cursor = e - 1n
  if (g.cursor < mediaStart) g.cursor = mediaStart
}, 50)
let lastReady = readiness()
setInterval(() => {
  if (readiness() !== lastReady) {
    lastReady = readiness()
    emit('ready', 'media', null, { ready: lastReady })
  }
}, 250)

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' })
  res.end(JSON.stringify(body))
}
const groupInfo = () => ({ flow_id: FLOW, group: GROUP, time_domain: 'tai', grid: state().grid, ready: readiness(), angles: angles(), source: 'tams+https://mock.example/' })

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (req.method === 'OPTIONS') return send(res, 204, {})
  const parts = url.pathname.split('/').filter(Boolean) // api replay [flow [group [state|command]]]
  if (parts[0] !== 'api' || parts[1] !== 'replay') return send(res, 404, { error: 'invalid', details: 'unknown route' })
  if (parts.length === 2) return send(res, 200, { api_version: 2, features: ['follow_live', 'client_ref', 'mark_at', 'offset_ms', 'jog_grid'], groups: [groupInfo()] })
  if (parts[2] !== FLOW) return send(res, 404, { error: 'invalid', details: 'unknown flow' })
  if (parts.length === 3) return send(res, 200, { groups: [groupInfo()] })
  if (parts[3] !== GROUP) return send(res, 404, { error: 'invalid', details: 'unknown group' })
  if (parts.length === 4 || parts[4] === 'state') return send(res, 200, parts.length === 4 ? groupInfo() : state())
  if (parts[4] === 'command' && req.method === 'POST') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        const cmd = JSON.parse(raw)
        send(res, 200, answer(cmd, cmd.client_ref))
      } catch (e) {
        send(res, e instanceof CmdError && e.code === 'out_of_range' ? 409 : e instanceof CmdError && e.code === 'conflict' ? 409 : 400, { error: e instanceof CmdError ? e.code : 'invalid', details: e.message })
      }
    })
    return
  }
  send(res, 404, { error: 'invalid', details: 'unknown route' })
})

const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (!url.pathname.endsWith(`/api/replay/${FLOW}/${GROUP}/ws`)) return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => {
    const ms = Math.min(1000, Math.max(50, Number(url.searchParams.get('state_ms') ?? 50)))
    clients.add(ws)
    const timer = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'state', ...state() })), ms)
    ws.on('message', (data) => {
      let cmd
      try {
        cmd = JSON.parse(String(data))
      } catch {
        return
      }
      try {
        ws.send(JSON.stringify({ type: 'result', seq: cmd.seq, ...answer(cmd, cmd.client_ref) }))
      } catch (e) {
        ws.send(JSON.stringify({ seq: cmd.seq, error: e instanceof CmdError ? e.code : 'invalid', details: e.message }))
      }
    })
    ws.on('close', () => {
      clearInterval(timer)
      clients.delete(ws)
    })
  })
})
server.listen(PORT, () => console.log(`mock replay API v3 on http://localhost:${PORT}  (flow "${FLOW}", group "${GROUP}")`))
