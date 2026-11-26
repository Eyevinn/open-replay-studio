import { useMemo, useState } from 'react'
import { Page } from '../app/Page'
import { go } from '../app/router'
import { Icon } from '../app/icons'
import { RecordedState, TagList } from '../components/Bits'
import { useNow } from '../lib/useNow'
import { actions, commonTags, isLive, useData } from '../state/store'
import type { Member, TagRule } from '../model'

const pair = (r: TagRule) => `${r.tag}=${r.value}`
export const ADHOC_KEY = 'open-replay-studio.adhoc'

/** Browse what the store holds, pick streams, and make them a group. */
export function Streams() {
  const now = useNow()
  const { store } = useData()
  const all = store.streams
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [liveOnly, setLiveOnly] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [offsets, setOffsets] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [keepRule, setKeepRule] = useState('')
  const [error, setError] = useState('')

  const tagOptions = useMemo(() => [...new Set(all.flatMap((s) => Object.entries(s.tags).map(([k, v]) => `${k}=${v}`)))].sort(), [all])
  const shown = all.filter(
    (s) =>
      s.label.toLowerCase().includes(query.trim().toLowerCase()) &&
      (!tagFilter || Object.entries(s.tags).some(([k, v]) => `${k}=${v}` === tagFilter)) &&
      (!liveOnly || isLive(s)),
  )
  const selected = picked.flatMap((id) => all.find((s) => s.id === id) ?? [])
  const common = commonTags(selected)
  const rule = common.find((r) => pair(r) === keepRule) ?? null

  const toggle = (id: string) => {
    setError('')
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }
  const allShownPicked = shown.length > 0 && shown.every((s) => picked.includes(s.id))
  const toggleShown = () => setPicked((p) => (allShownPicked ? p.filter((id) => !shown.some((s) => s.id === id)) : [...p, ...shown.map((s) => s.id).filter((id) => !p.includes(id))]))

  /** The members as typed, or the reason they cannot be used yet. */
  function build(): Member[] | string {
    if (selected.length === 0) return 'Pick at least one stream.'
    const members: Member[] = []
    for (const [i, s] of selected.entries()) {
      const raw = (offsets[s.id] ?? '0').trim()
      if (!/^-?\d+$/.test(raw)) return `The offset of ${s.label} must be whole milliseconds, for example -40.`
      members.push({ streamId: s.id, key: i + 1, label: (labels[s.id] ?? s.label).trim() || s.label, offsetMs: Number(raw) })
    }
    return members
  }

  function create() {
    const members = build()
    if (typeof members === 'string') return setError(members)
    const finalName = name.trim()
    if (!finalName) return setError('Give the group a name.')
    actions.createGroup(finalName, members, rule)
    go('groups')
  }

  function openOnce() {
    const members = build()
    if (typeof members === 'string') return setError(members)
    try {
      sessionStorage.setItem(ADHOC_KEY, JSON.stringify({ members }))
    } catch {
      // The replay screen then shows an empty selection.
    }
    go('replay/adhoc')
  }

  return (
    <Page title="Streams" subtitle="Recorded streams in the store. Pick the ones that belong together." actions={<span className="muted">{store.status === 'ok' ? `${all.length} in the store` : store.status === 'loading' ? 'Reading the store' : 'Store not reachable'}</span>}>
      {store.status === 'error' && (
        <p className="notice" role="alert">
          The store could not be read: {store.error}
        </p>
      )}
      {store.status === 'ok' && all.length === 0 && <p className="muted">The store holds no recordings yet. Streams appear here once something is written to it.</p>}
      <div className="split">
        <div className="main-col">
          <div className="filters">
            <label className="field-inline">
              <span className="sr-only">Search label</span>
              <Icon name="search" size={16} />
              <input type="search" placeholder="Search label" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label className="field-inline">
              <span className="sr-only">Filter by tag</span>
              <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                <option value="">Any tag</option>
                {tagOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} /> Live only
            </label>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th className="col-check">
                  <input type="checkbox" aria-label="Select all shown" checked={allShownPicked} onChange={toggleShown} />
                </th>
                <th>Label</th>
                <th>Tags</th>
                <th>Format</th>
                <th>Recorded</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className={picked.includes(s.id) ? 'row-picked' : undefined}>
                  <td className="col-check">
                    <input type="checkbox" aria-label={`Select ${s.label}`} checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                  </td>
                  <td className="strong">{s.label}</td>
                  <td>
                    <TagList tags={s.tags} />
                  </td>
                  <td className="muted">{s.format}</td>
                  <td>
                    <RecordedState stream={s} now={now} />
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted center">
                    No stream matches. Clear a filter to see more.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="hint">Everything here comes from the store: labels, tags, format and the first and last segment. A stream with no tags can still be picked.</p>
        </div>

        <aside className="side" aria-label="New group">
          <h2>New group</h2>
          <label className="field">
            <span>Name</span>
            <input type="text" value={name} placeholder="Match 42 cameras" onChange={(e) => { setName(e.target.value); setError('') }} />
          </label>
          <div className="side-list-head">
            <span>{selected.length === 0 ? 'No streams picked' : `${selected.length} stream${selected.length === 1 ? '' : 's'}, in key order`}</span>
          </div>
          {selected.length > 0 && (
            <ul className="members">
              {selected.map((s, i) => (
                <li key={s.id}>
                  <span className="key">{i + 1}</span>
                  <input aria-label={`Label for ${s.label}`} type="text" value={labels[s.id] ?? s.label} onChange={(e) => setLabels({ ...labels, [s.id]: e.target.value })} />
                  <input aria-label={`Offset in milliseconds for ${s.label}`} className="offset" type="text" inputMode="numeric" value={offsets[s.id] ?? '0'} onChange={(e) => setOffsets({ ...offsets, [s.id]: e.target.value })} />
                  <span className="muted unit">ms</span>
                  <button className="icon-btn" aria-label={`Remove ${s.label}`} onClick={() => toggle(s.id)}>
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {common.length > 0 && (
            <label className="field">
              <span>Keep adding streams that match</span>
              <select value={rule ? pair(rule) : ''} onChange={(e) => setKeepRule(e.target.value)}>
                <option value="">Don't, keep this list</option>
                {common.map((r) => (
                  <option key={pair(r)} value={pair(r)}>
                    {pair(r)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="btn-row">
            <button className="primary" onClick={create}>
              Create group
            </button>
            <button onClick={openOnce}>Open once</button>
          </div>
          <p className="hint">Changing a group's streams later restarts its replay session.</p>
        </aside>
      </div>
    </Page>
  )
}
