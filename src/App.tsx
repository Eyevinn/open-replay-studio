import { useCallback, useEffect, useMemo, useState } from 'react'
import { StromController } from './lib/stromController'
import { useReplayState } from './lib/useReplay'
import { Desk } from './components/Desk'
import { Timecode, Transport } from './components/Transport'
import { replayStatus, setPreview, take, type Mixer, type ReplayStatus } from './lib/replayApi'

type Running = Extract<ReplayStatus, { running: true }>

/** The operator screen of one running replay: preview, program and sources, and the transport that moves its playhead. */
export function App({ groupId, status }: { groupId: string; status: Running }) {
  const controller = useMemo(() => new StromController({ stromUrl: status.stromUrl, group: status.group }), [status.stromUrl, status.group])
  useEffect(() => () => controller.dispose(), [controller])
  const { offsetMs, connected } = useReplayState(controller)

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

  const act = useCallback(
    async (job: () => Promise<Mixer>) => {
      setBusy(true)
      setError('')
      try {
        setMixer(await job())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [],
  )
  const onPreview = useCallback((i: number) => void act(() => setPreview(groupId, i)), [act, groupId])
  const onTake = useCallback(() => void act(() => take(groupId)), [act, groupId])

  const sources = status.sources
  const preview = mixer.preview !== null ? sources[mixer.preview] : undefined
  const program = mixer.program !== null ? sources[mixer.program] : undefined
  const canTake = !busy && preview !== undefined && mixer.preview !== mixer.program

  // Keys 1-9 pick a source for preview, Enter takes it.
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

  return (
    <div className="app">
      <main>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Timecode
          controller={controller}
          lead={
            <>
              <h2>Replay</h2>
              <div className="status">
                <span className={connected ? 'chip chip-ok' : 'chip'}>{connected ? 'Connected' : 'Offline'}</span>
                <span className={offsetMs === 0 ? 'chip' : 'chip chip-replay'}>{offsetMs === 0 ? 'Live' : 'Replay'}</span>
              </div>
            </>
          }
        />
        <Desk status={status} mixer={mixer} busy={busy} onPreview={onPreview} />
      </main>
      {/* At the bottom of the page and kept in view: where the playhead is moved, and where a source is taken out. */}
      <footer className="controls" aria-label="Replay controls">
        <Transport controller={controller}>
          <div className="take-group">
            <div className="on-air">
              <span className="tag tag-pgm">PGM</span> {program?.label ?? 'Black'}
            </div>
            <button className="take" disabled={!canTake} onClick={onTake} title="Send the preview out as program (Enter)">
              Take{preview && canTake ? <small>{preview.label}</small> : null}
            </button>
          </div>
        </Transport>
      </footer>
    </div>
  )
}
