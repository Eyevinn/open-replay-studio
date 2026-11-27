import { errorOf, result, view } from './normalize'
import { ReplayCommandError, type Command, type CommandResult, type ReplayEvent, type ReplayView } from './types'

const EMPTY: ReplayView = {
  connected: false,
  timeDomain: null,
  ready: null,
  angles: [],
  motion: { speed: null, live: null, cue: null, ramping: false, cursor: null },
  range: { start: null, liveEdge: null, liveEdgeEstimate: null, end: null },
  onAir: { behindLiveMs: null, behindLiveEstimateMs: null, ageMs: null },
  grid: { outputFrameNs: null, sourceFrameNs: null },
  followLive: null,
  jogGrid: null,
  liveMargin: { ms: null, source: null },
}

const RECONNECT_MS = 2000
const COMMAND_TIMEOUT_MS = 6000
const MAX_EVENTS = 60

export interface ReplayClientOptions {
  /** Where Strom's replay API is, for example the Open Replay API's /api/v1/strom, or a mock. */
  baseUrl: string
  flowId: string
  group: string
  /** State interval, ms (50 to 1000). */
  stateMs?: number
}

/**
 * A client of Strom's replay API v3 for one group: state and events over the WebSocket, commands with a seq and a
 * client_ref, answered in order. A command goes over the socket when it is open and over REST when it is not.
 * Subscribe with `subscribe` and read with `getView` / `getEvents` (React: useSyncExternalStore).
 */
export class ReplayV3Client {
  private current: ReplayView = EMPTY
  private events: ReplayEvent[] = []
  private listeners = new Set<() => void>()
  private ws: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private closed = false
  private seq = 0
  private refCount = 0
  private lastEventSeq: number | null = null
  private pending = new Map<number, { resolve: (r: CommandResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private readonly session = Math.random().toString(36).slice(2, 7)
  private readonly own = new Set<string>()

  constructor(private readonly opts: ReplayClientOptions) {}

  /** Open the connection. Safe to call again after `dispose`: React mounts, unmounts and mounts a component in development. */
  start() {
    this.closed = false
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) this.connect()
  }

  private get base() {
    return `${this.opts.baseUrl.replace(/\/+$/, '')}/api/replay/${this.opts.flowId}/${encodeURIComponent(this.opts.group)}`
  }

  getView = () => this.current
  getEvents = () => this.events
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  private notify() {
    this.listeners.forEach((l) => l())
  }

  dispose() {
    this.closed = true
    clearTimeout(this.timer)
    const ws = this.ws
    this.ws = null
    ws?.close()
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new ReplayCommandError('The replay was closed.', 'timeout'))
    }
    this.pending.clear()
  }

  private connect() {
    if (this.closed) return
    const url = `${this.base.replace(/^http/, 'ws')}/ws?state_ms=${this.opts.stateMs ?? 100}`
    try {
      const ws = new WebSocket(url)
      this.ws = ws
      ws.onopen = () => {
        if (this.ws !== ws) return ws.close()
        this.current = { ...this.current, connected: true }
        this.lastEventSeq = null
        this.notify()
      }
      ws.onmessage = (m) => this.onMessage(m.data as string)
      ws.onclose = () => {
        if (this.ws === ws) this.lost()
      }
      ws.onerror = () => ws.close()
    } catch {
      this.lost()
    }
  }

  private lost() {
    this.current = { ...this.current, connected: false }
    this.notify()
    for (const [seq, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new ReplayCommandError('The connection to the replay was lost.', 'timeout'))
      this.pending.delete(seq)
    }
    if (this.closed) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.connect(), RECONNECT_MS)
  }

  private onMessage(data: string) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }
    const type = typeof msg['type'] === 'string' ? (msg['type'] as string) : null
    if (type === 'state') {
      this.current = { ...view(msg), connected: true }
      this.notify()
      return
    }
    if (type === 'lagged') {
      this.pushEvent({ seq: null, type: 'lagged', cause: null, clientRef: null, raw: msg })
      void this.refresh()
      return
    }
    if (type === 'diagnostics') return
    // A reply to a command: it echoes our seq.
    const seq = typeof msg['seq'] === 'number' ? (msg['seq'] as number) : null
    if (seq !== null && this.pending.has(seq) && typeof msg['event_seq'] !== 'number') {
      const p = this.pending.get(seq)!
      this.pending.delete(seq)
      clearTimeout(p.timer)
      const err = errorOf(msg)
      if (err) p.reject(new ReplayCommandError(err.details || err.code, err.code))
      else p.resolve(result(msg))
      return
    }
    // An event, with its reason and the client_ref of the command that caused it.
    if (typeof msg['event_seq'] === 'number') {
      const eventSeq = msg['event_seq'] as number
      if (this.lastEventSeq !== null && eventSeq > this.lastEventSeq + 1) {
        this.pushEvent({ seq: null, type: 'missed', cause: null, clientRef: null, raw: { from: this.lastEventSeq + 1, to: eventSeq - 1 } })
        void this.refresh()
      }
      this.lastEventSeq = eventSeq
      this.pushEvent({
        seq: eventSeq,
        type: type ?? 'event',
        cause: typeof msg['cause'] === 'string' ? (msg['cause'] as string) : null,
        clientRef: typeof msg['client_ref'] === 'string' ? (msg['client_ref'] as string) : null,
        raw: msg,
      })
    }
  }

  private pushEvent(e: Omit<ReplayEvent, 'at' | 'own'>) {
    const own = e.clientRef !== null && this.own.has(e.clientRef)
    this.events = [{ ...e, own, at: Date.now() }, ...this.events].slice(0, MAX_EVENTS)
    this.notify()
  }

  /** Read the state over REST, for after a lost event. */
  async refresh(): Promise<void> {
    try {
      const res = await fetch(`${this.base}/state`)
      if (res.ok) {
        this.current = { ...view(await res.json()), connected: this.current.connected }
        this.notify()
      }
    } catch {
      // The socket will bring the state anyway.
    }
  }

  /** Send a command. Rejects with ReplayCommandError (`invalid`, `conflict`, `out_of_range`, `timeout`). */
  send(cmd: Command): Promise<CommandResult> {
    const clientRef = `${this.session}-${++this.refCount}`
    this.own.add(clientRef)
    const body = { ...cmd, client_ref: clientRef }
    if (this.ws?.readyState === WebSocket.OPEN) {
      const seq = ++this.seq
      return new Promise<CommandResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(seq)
          reject(new ReplayCommandError('The replay did not answer.', 'timeout'))
        }, COMMAND_TIMEOUT_MS)
        this.pending.set(seq, { resolve, reject, timer })
        this.ws!.send(JSON.stringify({ ...body, seq }))
      })
    }
    return this.sendRest(body)
  }

  private async sendRest(body: Record<string, unknown>): Promise<CommandResult> {
    const res = await fetch(`${this.base}/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const json: unknown = await res.json().catch(() => ({}))
    const err = errorOf(json)
    if (!res.ok || err) throw new ReplayCommandError(err?.details || err?.code || `${res.status} ${res.statusText}`, err?.code ?? 'invalid')
    return result(json)
  }
}

/** What Strom says about its replay API, or null for an older Strom that has none (v1). */
export async function detectReplayApi(baseUrl: string): Promise<{ version: number; features: string[] } | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/replay`)
    if (!res.ok) return null
    const body = (await res.json()) as { api_version?: unknown; features?: unknown }
    if (typeof body.api_version !== 'number') return null
    return { version: body.api_version, features: Array.isArray(body.features) ? body.features.filter((f): f is string => typeof f === 'string') : [] }
  } catch {
    return null
  }
}
