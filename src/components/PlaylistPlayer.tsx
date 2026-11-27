import { useCallback, useEffect, useState } from 'react'
import type { EndAction, Group, Playlist } from '../model'
import { actions } from '../state/store'
import { playlistRun, playPlaylist, stopPlaylist, type PlaylistRun } from '../lib/replayApi'

const END_ACTIONS: { value: EndAction; label: string }[] = [
  { value: 'freeze', label: 'Hold the last frame' },
  { value: 'loop', label: 'Play again' },
  { value: 'live', label: 'Go live' },
]

const say = (r: PlaylistRun, playlist: Playlist): string => {
  if (r.state === 'running') return `Playing item ${(r.index ?? 0) + 1} of ${r.total ?? playlist.items.length}${r.queued ? ` · ${r.queued} queued` : ''}${r.round ? ` · round ${r.round + 1}` : ''}`
  if (r.state === 'finished') return 'Finished.'
  if (r.state === 'stopped') return 'Stopped.'
  if (r.state === 'failed') return `Stopped by an error: ${r.error ?? 'unknown'}`
  return ''
}

/** Play a playlist on clip player A of a group's replay, and follow its progress. */
export function PlaylistPlayer({ playlist, groups, onRun, compact }: { playlist: Playlist; groups: Group[]; onRun?: (run: PlaylistRun) => void; compact?: boolean }) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '')
  const [run, setRun] = useState<PlaylistRun>({ running: false })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const gid = groups.some((g) => g.id === groupId) ? groupId : (groups[0]?.id ?? '')
  const mine = run.playlistId === playlist.id ? run : { running: false }
  useEffect(() => onRun?.(run), [run, onRun])

  // Read the progress now and every second while something plays.
  useEffect(() => {
    if (!gid) return
    let live = true
    const read = () => playlistRun(gid).then((r) => live && setRun(r), () => undefined)
    void read()
    const timer = setInterval(() => void read(), 1000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [gid])

  const act = useCallback(async (fn: () => Promise<PlaylistRun>) => {
    setBusy(true)
    setError('')
    try {
      setRun(await fn())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  if (groups.length === 0) return <p className="muted">Make a group and start its replay to play a playlist on it.</p>
  const playing = mine.running === true
  return (
    <section className={compact ? 'pp-play' : 'panel'} aria-label="Play this playlist">
      {!compact && <h3>Play</h3>}
      <p className="muted small">It plays on clip player A and shows in preview. Take sends it to air.</p>
      <div className="form-row">
        {groups.length > 1 && (
          <label className="field-inline">
            <span>Replay</span>
            <select value={gid} onChange={(e) => setGroupId(e.target.value)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field-inline">
          <span>At the end</span>
          <select value={playlist.endAction ?? 'freeze'} onChange={(e) => actions.updatePlaylist(playlist.id, { endAction: e.target.value as EndAction })}>
            {END_ACTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="btn-row">
        <button disabled={busy || playing || playlist.items.length === 0} onClick={() => act(() => playPlaylist(gid, playlist.id))}>
          Play playlist
        </button>
        <button className="ghost" disabled={busy || !playing} onClick={() => act(() => stopPlaylist(gid))}>
          Stop
        </button>
        <span className="muted small" role="status">
          {say(mine, playlist)}
        </span>
      </div>
      {(mine.skipped?.length ?? 0) > 0 && <p className="notice">{mine.skipped!.length} clip(s) of this playlist no longer exist and were left out.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
