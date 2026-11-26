import { useEffect, useRef, useState, type RefObject } from 'react'
import { connectWhep, WHEP_CONNECT_DELAY_MS } from '../lib/whep'

/** One video over its own WebRTC connection. Reconnects when `url` changes; an empty `url` shows nothing. */
export function WhepVideo({ url, label, className, videoRef }: { url: string | null; label?: string; className?: string; videoRef?: RefObject<HTMLVideoElement | null> }) {
  const own = useRef<HTMLVideoElement>(null)
  const ref = videoRef ?? own
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    if (!url) {
      if (ref.current) ref.current.srcObject = null
      return
    }
    let stop: (() => void) | undefined
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    // Strom's video endpoints come up a few seconds after a replay starts, so a refused connection is tried again.
    const connect = (attempt: number) => {
      connectWhep(url, (stream) => {
        if (!cancelled && ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream
      })
        .then((s) => {
          if (cancelled) s()
          else {
            stop = s
            setError(null)
          }
        })
        .catch((e: Error) => {
          if (cancelled) return
          if (attempt >= 6) setError(e.message)
          else timer = setTimeout(() => connect(attempt + 1), 2500)
        })
    }
    // Wait a moment first: a connection dropped before it was ever needed is not opened at all (see whep.ts).
    timer = setTimeout(() => connect(0), WHEP_CONNECT_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      stop?.()
    }
  }, [url])

  return (
    <div className={`mv-frame ${className ?? ''}`}>
      <video ref={ref as RefObject<HTMLVideoElement>} autoPlay playsInline muted className="mv-video" aria-label={label} />
      {error && <div className="mv-badge mv-badge-err">Cannot connect: {error}</div>}
    </div>
  )
}
