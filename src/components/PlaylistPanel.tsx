import { useState } from 'react'
import { Icon } from '../app/icons'
import { formatClipLength, formatSpeed } from '../lib/format'
import type { PlaylistRun } from '../lib/replayApi'
import { SPEEDS, type Group, type Playlist } from '../model'
import { actions, useData } from '../state/store'
import { PlaylistPlayer } from './PlaylistPlayer'

/**
 * Playlists beside the replay, to build and play them while the replay runs: pick or make a playlist, add the clips of
 * this group, set each item's speed, play it on clip player A. Clips are added from the library here, or straight from
 * the controls with "Save clip and add".
 */
export function PlaylistPanel({ group, activeId, onActive, onClose }: { group: Group; activeId: string | null; onActive: (id: string) => void; onClose: () => void }) {
  const { playlists, clips } = useData()
  const [name, setName] = useState('')
  const [adding, setAdding] = useState('')
  const [run, setRun] = useState<PlaylistRun>({ running: false })

  const active = playlists.find((p) => p.id === activeId) ?? playlists[0]
  const groupClips = clips.filter((c) => c.groupId === group.id)
  const clipOf = (id: string) => clips.find((c) => c.id === id)
  const length = (p: Playlist) => p.items.reduce((sum, it) => sum + (clipOf(it.clipId)?.durationMs ?? 0) / it.speed, 0)
  const playing = active && run.running === true && run.playlistId === active.id ? run : null

  const create = () => {
    const n = name.trim()
    if (!n) return
    onActive(actions.createPlaylist(n))
    setName('')
  }

  return (
    <aside className="playlist-panel" aria-label="Playlists">
      <div className="pp-head">
        <h2>Playlists</h2>
        <button className="icon-btn" aria-label="Close the playlists" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>

      <div className="pp-row">
        <label className="field-inline grow">
          <span className="sr-only">Playlist</span>
          <select value={active?.id ?? ''} onChange={(e) => onActive(e.target.value)}>
            {playlists.length === 0 && <option value="">No playlist yet</option>}
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.items.length})
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="pp-row">
        <input className="grow" type="text" value={name} placeholder="New playlist" aria-label="New playlist" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <button onClick={create} disabled={!name.trim()}>
          <Icon name="plus" size={14} /> New
        </button>
      </div>

      {active && (
        <>
          <div className="muted small">
            {active.items.length} clip{active.items.length === 1 ? '' : 's'} · {formatClipLength(length(active))}
          </div>
          {active.items.length === 0 ? (
            <p className="muted small">Empty. Add a clip below, or save one from the controls with "Save and add".</p>
          ) : (
            <ol className="pp-items">
              {active.items.map((it, i) => {
                const clip = clipOf(it.clipId)
                return (
                  <li key={`${it.clipId}-${i}`} className={`pp-item${playing?.index === i ? ' now' : ''}`} aria-current={playing?.index === i ? 'true' : undefined}>
                    <span className="num">{i + 1}</span>
                    <div className="grow">
                      <div className="strong">{clip?.name ?? 'Missing clip'}</div>
                      <div className="muted small">{clip ? formatClipLength(clip.durationMs / it.speed) : 'This clip was deleted.'}</div>
                    </div>
                    <select aria-label={`Speed of item ${i + 1}`} value={it.speed} onChange={(e) => actions.setItemSpeed(active.id, i, Number(e.target.value))}>
                      {SPEEDS.map((s) => (
                        <option key={s} value={s}>
                          {formatSpeed(s)}
                        </option>
                      ))}
                    </select>
                    <button className="icon-btn" aria-label={`Move item ${i + 1} up`} disabled={i === 0} onClick={() => actions.moveItem(active.id, i, -1)}>
                      <Icon name="up" size={14} />
                    </button>
                    <button className="icon-btn" aria-label={`Move item ${i + 1} down`} disabled={i === active.items.length - 1} onClick={() => actions.moveItem(active.id, i, 1)}>
                      <Icon name="down" size={14} />
                    </button>
                    <button className="icon-btn" aria-label={`Remove item ${i + 1}`} onClick={() => actions.removeItem(active.id, i)}>
                      <Icon name="x" size={14} />
                    </button>
                  </li>
                )
              })}
            </ol>
          )}

          <div className="pp-row">
            <label className="field-inline grow">
              <span className="sr-only">Add a clip</span>
              <select value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">{groupClips.length === 0 ? 'No clips of this group yet' : 'Add a clip…'}</option>
                {groupClips.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {formatClipLength(c.durationMs)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!adding}
              onClick={() => {
                actions.addItem(active.id, adding)
                setAdding('')
              }}
            >
              Add
            </button>
          </div>

          <PlaylistPlayer key={active.id} playlist={active} groups={[group]} onRun={setRun} compact />
        </>
      )}
    </aside>
  )
}
