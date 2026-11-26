import { useEffect, useRef, useState } from 'react'
import { LatencyMeter, type LatencyStats } from '../lib/burnin'

const LIVE_URL = import.meta.env.OPEN_REPLAY_LATENCY_LIVE_WHEP_URL as string | undefined
const REPLAY_URL = import.meta.env.OPEN_REPLAY_LATENCY_REPLAY_WHEP_URL as string | undefined

/** The panel is shown only when both program outputs of the latency test are configured. */
export const latencyEnabled = Boolean(LIVE_URL && REPLAY_URL)

const sec = (ms: number) => `${(ms / 1000).toFixed(2)} s`

function useMeter(url: string) {
  const video = useRef<HTMLVideoElement>(null)
  const [stats, setStats] = useState<LatencyStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const meter = new LatencyMeter(url, video.current!)
    const id = setInterval(() => {
      setStats(meter.stats())
      setError(meter.error)
    }, 250)
    return () => {
      clearInterval(id)
      meter.dispose()
    }
  }, [url])
  return { video, stats, error }
}

function Card({ title, sub, m }: { title: string; sub: string; m: ReturnType<typeof useMeter> }) {
  return (
    <div className="lat-card">
      <video ref={m.video} autoPlay playsInline muted className="lat-thumb" />
      <div className="lat-body">
        <div className="lat-title">{title}</div>
        <div className="lat-value">{m.stats ? sec(m.stats.medianMs) : '--'}</div>
        <div className="lat-sub">
          {m.error
            ? `Cannot connect: ${m.error}`
            : m.stats
              ? `${sub} · p95 ${sec(m.stats.p95Ms)} · ${sec(m.stats.minMs)} to ${sec(m.stats.maxMs)}`
              : 'waiting for a frame with a burned-in time'}
        </div>
      </div>
    </div>
  )
}

export function Latency() {
  const live = useMeter(LIVE_URL!)
  const replay = useMeter(REPLAY_URL!)
  const gap = live.stats && replay.stats ? replay.stats.medianMs - live.stats.medianMs : null
  return (
    <section className="latency" aria-label="Latency">
      <div className="lat-head">
        <span>Delay from the input to the screen</span>
        <span className="lat-gap">{gap === null ? '' : `Replay is ${sec(gap)} behind Open Live`}</span>
      </div>
      <div className="lat-cards">
        <Card title="Open Live program" sub="live path" m={live} />
        <Card title="Open Replay program" sub="via TAMS, with the replay offset" m={replay} />
      </div>
    </section>
  )
}
