import { useState } from 'react'
import { Empty, Page } from '../app/Page'
import { href } from '../app/router'
import { Icon } from '../app/icons'
import { Pill } from '../components/Bits'
import { formatClipLength, formatClock, formatSpeed } from '../lib/format'
import { actions, streamById, useData } from '../state/store'

/** Marks and clips of every group. A clip points into the recording; it is never a copy. */
export function Library() {
  const { groups, marks, clips, playlists, settings } = useData()
  const [groupId, setGroupId] = useState('')
  const [tag, setTag] = useState('')
  const [query, setQuery] = useState('')
  const [starredOnly, setStarredOnly] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? 'Deleted group'
  const clipsShown = clips.filter((c) => (!groupId || c.groupId === groupId) && (!tag || c.tag === tag) && (!starredOnly || c.starred) && c.name.toLowerCase().includes(q))
  const marksShown = marks.filter((m) => (!groupId || m.groupId === groupId) && (!tag || m.tag === tag) && m.name.toLowerCase().includes(q))

  return (
    <Page title="Library" subtitle="Clips and marks. A clip is a range on one stream with a speed.">
      <div className="filters">
        <label className="field-inline">
          <span className="sr-only">Group</span>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          <span className="sr-only">Search name</span>
          <Icon name="search" size={16} />
          <input type="search" placeholder="Search name" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="chip-filter" role="group" aria-label="Filter by tag">
          <button aria-pressed={tag === ''} className={tag === '' ? 'on' : ''} onClick={() => setTag('')}>
            All
          </button>
          {settings.markTags.map((t) => (
            <button key={t} aria-pressed={tag === t} className={tag === t ? 'on' : ''} onClick={() => setTag(tag === t ? '' : t)}>
              {t}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={starredOnly} onChange={(e) => setStarredOnly(e.target.checked)} /> Starred only
        </label>
      </div>

      <h2 className="section">Clips</h2>
      {clips.length === 0 ? (
        <Empty title="No clips yet">Mark a moment during a replay, then turn the mark into a clip here.</Empty>
      ) : clipsShown.length === 0 ? (
        <p className="muted">No clip matches these filters.</p>
      ) : (
        <ul className="rows">
          {clipsShown.map((c) => (
            <li key={c.id} className="row">
              <button className={`icon-btn star${c.starred ? ' on' : ''}`} aria-pressed={c.starred} aria-label={c.starred ? `Remove star from ${c.name}` : `Star ${c.name}`} onClick={() => actions.toggleStar(c.id)}>
                <Icon name="star" size={16} fill={c.starred} />
              </button>
              <div className="thumb" aria-hidden="true">
                <Icon name="clip" size={18} />
              </div>
              <div className="grow">
                <div className="strong">{c.name}</div>
                <div className="muted small">
                  {streamById(c.streamId)?.label ?? 'Missing stream'} · {formatClock(c.at)} · {formatClipLength(c.durationMs)} · {formatSpeed(c.speed)} · {groupName(c.groupId)}
                </div>
              </div>
              {c.tag && <Pill tone="accent">{c.tag}</Pill>}
              <label className="field-inline">
                <span className="sr-only">Add {c.name} to a playlist</span>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) actions.addItem(e.target.value, c.id)
                  }}
                >
                  <option value="">{playlists.length === 0 ? 'No playlist yet' : 'Add to playlist…'}</option>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {confirm === c.id ? (
                <span className="confirm">
                  Delete clip?
                  <button className="danger" onClick={() => { actions.deleteClip(c.id); setConfirm(null) }}>
                    Delete
                  </button>
                  <button onClick={() => setConfirm(null)}>Keep</button>
                </span>
              ) : (
                <button className="ghost" aria-label={`Delete ${c.name}`} onClick={() => setConfirm(c.id)}>
                  <Icon name="trash" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {playlists.length === 0 && clips.length > 0 && (
        <p className="hint">
          To build a sequence, <a href={href('playlists')}>make a playlist</a> first.
        </p>
      )}

      <h2 className="section">Marks without a clip</h2>
      {marksShown.length === 0 ? (
        <p className="muted">{marks.length === 0 ? 'No marks yet.' : 'No mark matches these filters.'}</p>
      ) : (
        <ul className="rows">
          {marksShown.map((m) => (
            <li key={m.id} className="row">
              <div className="grow">
                <div className="strong">{m.name}</div>
                <div className="muted small">
                  {formatClock(m.at)} · {groupName(m.groupId)}
                </div>
              </div>
              {m.tag && <Pill tone="accent">{m.tag}</Pill>}
              <button onClick={() => actions.clipFromMark(m.id)}>Make clip</button>
              <button className="ghost" aria-label={`Delete mark ${m.name}`} onClick={() => actions.deleteMark(m.id)}>
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
