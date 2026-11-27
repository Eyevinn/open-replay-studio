import { useState } from 'react'
import type { Clip, Group } from '../model'
import { clearClip, cueClip } from '../lib/replayApi'

/** Put a clip on clip player B of its group's replay, from its own camera or another one at the same moment. */
export function ClipCue({ clip, group }: { clip: Clip; group: Group | undefined }) {
  const [streamId, setStreamId] = useState(clip.streamId)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!group || group.members.length === 0) return null

  const label = (id: string) => group.members.find((m) => m.streamId === id)?.label ?? 'camera'
  const send = async (play: boolean) => {
    setBusy(true)
    setError('')
    try {
      const r = await cueClip(clip.groupId, clip.id, { streamId, play })
      setNote(`${r.playing ? 'Playing' : 'Cued'} on B from ${label(r.streamId)}, in preview`)
    } catch (err) {
      setNote('')
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const clear = async () => {
    setBusy(true)
    setError('')
    try {
      await clearClip(clip.groupId)
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="clip-cue">
      <label className="field-inline">
        <span className="sr-only">Camera for {clip.name}</span>
        <select value={streamId} onChange={(e) => setStreamId(e.target.value)}>
          {group.members.map((m) => (
            <option key={m.streamId} value={m.streamId}>
              {m.label}
              {m.streamId === clip.streamId ? ' (clip)' : ''}
            </option>
          ))}
        </select>
      </label>
      <button disabled={busy} onClick={() => send(false)} aria-label={`Cue ${clip.name} on B`}>
        Cue on B
      </button>
      <button disabled={busy} onClick={() => send(true)} aria-label={`Play ${clip.name} on B`}>
        Play on B
      </button>
      {note && (
        <button className="ghost" disabled={busy} onClick={clear} aria-label="Clear player B">
          Clear
        </button>
      )}
      {note && <span className="muted small" role="status">{note}</span>}
      {error && <span className="error small" role="alert">{error}</span>}
    </span>
  )
}
