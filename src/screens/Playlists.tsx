import { useState } from 'react'
import { Empty, Page } from '../app/Page'
import { LibraryNotice } from '../components/Bits'
import { PlaylistPlayer } from '../components/PlaylistPlayer'
import { Icon } from '../app/icons'
import { formatClipLength, formatSpeed } from '../lib/format'
import { actions, useData } from '../state/store'
import { SPEEDS } from '../model'

/** Ordered clips, each with its own speed. */
export function Playlists() {
  const { playlists, clips, library, groups } = useData()
  const [selected, setSelected] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const current = playlists.find((p) => p.id === selected) ?? playlists[0]
  const lengthOf = (items: { clipId: string; speed: number }[]) =>
    items.reduce((sum, it) => {
      const clip = clips.find((c) => c.id === it.clipId)
      return clip ? sum + clip.durationMs / it.speed : sum
    }, 0)

  const create = () => {
    const name = newName.trim()
    if (!name) return setError('Give the playlist a name.')
    setSelected(actions.createPlaylist(name))
    setNewName('')
    setError('')
  }

  return (
    <Page title="Playlists" subtitle="Clips in the order you want to play them.">
      <LibraryNotice library={library} />
      <div className="split split-narrow">
        <aside className="side" aria-label="Playlists">
          <h2>Your playlists</h2>
          {playlists.length === 0 && <p className="muted">None yet.</p>}
          <ul className="list">
            {playlists.map((p) => (
              <li key={p.id}>
                <button className={`list-item${current?.id === p.id ? ' on' : ''}`} onClick={() => { setSelected(p.id); setConfirmDelete(false) }}>
                  <span className="strong">{p.name}</span>
                  <span className="muted small">
                    {p.items.length} clip{p.items.length === 1 ? '' : 's'} · {formatClipLength(lengthOf(p.items))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <label className="field">
            <span>New playlist</span>
            <input type="text" value={newName} placeholder="Half-time" onChange={(e) => { setNewName(e.target.value); setError('') }} onKeyDown={(e) => e.key === 'Enter' && create()} />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button onClick={create}>
            <Icon name="plus" size={14} /> Create playlist
          </button>
        </aside>

        <div className="main-col">
          {!current ? (
            <Empty title="Make your first playlist">A playlist plays clips one after another, each at its own speed, for a highlight package or a half-time show.</Empty>
          ) : (
            <>
              <div className="form-row">
                <label className="field">
                  <span>Name</span>
                  <input type="text" value={current.name} onChange={(e) => actions.updatePlaylist(current.id, { name: e.target.value })} />
                </label>
                <div className="stat">
                  <span className="muted small">Total length</span>
                  <b>{formatClipLength(lengthOf(current.items))}</b>
                </div>
              </div>
              {current.items.length === 0 ? (
                <p className="muted">This playlist is empty. Add a clip below.</p>
              ) : (
                <ol className="rows numbered">
                  {current.items.map((it, i) => {
                    const clip = clips.find((c) => c.id === it.clipId)
                    return (
                      <li key={`${it.clipId}-${i}`} className="row">
                        <span className="num">{i + 1}</span>
                        <div className="grow">
                          <div className="strong">{clip?.name ?? 'Missing clip'}</div>
                          <div className="muted small">{clip ? `${formatClipLength(clip.durationMs)} at 100%, ${formatClipLength(clip.durationMs / it.speed)} at ${formatSpeed(it.speed)}` : 'This clip was deleted.'}</div>
                        </div>
                        <label className="field-inline">
                          <span className="sr-only">Speed of item {i + 1}</span>
                          <select value={it.speed} onChange={(e) => actions.setItemSpeed(current.id, i, Number(e.target.value))}>
                            {SPEEDS.map((s) => (
                              <option key={s} value={s}>
                                {formatSpeed(s)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button className="icon-btn" aria-label={`Move item ${i + 1} up`} onClick={() => actions.moveItem(current.id, i, -1)}>
                          <Icon name="up" size={14} />
                        </button>
                        <button className="icon-btn" aria-label={`Move item ${i + 1} down`} onClick={() => actions.moveItem(current.id, i, 1)}>
                          <Icon name="down" size={14} />
                        </button>
                        <button className="icon-btn" aria-label={`Remove item ${i + 1}`} onClick={() => actions.removeItem(current.id, i)}>
                          <Icon name="x" size={14} />
                        </button>
                      </li>
                    )
                  })}
                </ol>
              )}
              <div className="add-row">
                <label className="field-inline">
                  <span className="sr-only">Add a clip</span>
                  <select value={adding} onChange={(e) => setAdding(e.target.value)}>
                    <option value="">{clips.length === 0 ? 'No clips yet' : 'Add a clip…'}</option>
                    {clips.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => {
                    if (adding) {
                      actions.addItem(current.id, adding)
                      setAdding('')
                    }
                  }}
                >
                  Add
                </button>
              </div>
              <PlaylistPlayer key={current.id} playlist={current} groups={groups} />
              <div className="btn-row">
                {confirmDelete ? (
                  <span className="confirm">
                    Delete this playlist? The clips stay.
                    <button className="danger" onClick={() => { actions.deletePlaylist(current.id); setSelected(null); setConfirmDelete(false) }}>
                      Delete playlist
                    </button>
                    <button onClick={() => setConfirmDelete(false)}>Keep</button>
                  </span>
                ) : (
                  <button className="ghost" onClick={() => setConfirmDelete(true)}>
                    <Icon name="trash" size={16} /> Delete playlist
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Page>
  )
}
