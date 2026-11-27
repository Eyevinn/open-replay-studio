import { useCallback, useEffect, useState } from 'react'
import { replayStatus, setPreview, take, type Mixer, type ReplayStatus } from './replayApi'

type Running = Extract<ReplayStatus, { running: true }>

/**
 * Preview and take for a running replay, through the Open Replay API: which source is on air and in preview, the
 * calls that change them, and the keys (1 to 9 pick a source for preview, Enter takes). Strom's mixer is the same
 * whichever version of the replay API it has.
 */
export function useMixer(groupId: string, status: Running) {
  const [mixer, setMixer] = useState<Mixer>(status.mixer)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Someone else (another operator, Strom's own screen) may switch too: read the mixer now and then.
  useEffect(() => {
    const id = setInterval(() => {
      if (busy) return
      replayStatus(groupId).then((s) => s.running && setMixer(s.mixer), () => {})
    }, 3000)
    return () => clearInterval(id)
  }, [groupId, busy])

  const act = useCallback(async (job: () => Promise<Mixer>) => {
    setBusy(true)
    setError('')
    try {
      setMixer(await job())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])
  const onPreview = useCallback((i: number) => void act(() => setPreview(groupId, i)), [act, groupId])
  const onTake = useCallback(() => void act(() => take(groupId)), [act, groupId])

  const sources = status.sources
  // The mixer's inputs are the cameras, then the clip players: Take works on any of them.
  const inputs = [...sources, ...status.clipPlayers.map((c) => ({ index: c.index, label: c.label }))]
  const preview = mixer.preview !== null ? inputs.find((s) => s.index === mixer.preview) : undefined
  const program = mixer.program !== null ? inputs.find((s) => s.index === mixer.program) : undefined
  const canTake = !busy && preview !== undefined && mixer.preview !== mixer.program

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Enter') {
        e.preventDefault()
        if (canTake) onTake()
      } else if (/^[1-9]$/.test(e.key) && sources[Number(e.key) - 1]) {
        onPreview(Number(e.key) - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sources, onPreview, onTake, canTake])

  return { mixer, busy, error, onPreview, onTake, canTake, preview, program }
}

/** The "PGM <source>" label and the Take button that sit at the end of the controls box. */
export type TakeParts = ReturnType<typeof useMixer>
