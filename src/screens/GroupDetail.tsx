import { useState } from 'react'
import { Empty, Page } from '../app/Page'
import { go, href } from '../app/router'
import { Icon } from '../app/icons'
import { RecordedState } from '../components/Bits'
import { useNow } from '../lib/useNow'
import { actions, getStreams, matchingStreams, streamById, useData } from '../state/store'

/** Edit what is in a group: its rule, and each stream's key, label and offset. */
export function GroupDetail({ id }: { id: string }) {
  const { groups } = useData()
  const now = useNow()
  const group = groups.find((g) => g.id === id)
  const [adding, setAdding] = useState('')
  const [restarted, setRestarted] = useState(false)

  if (!group) {
    return (
      <Page title="Group">
        <Empty title="This group doesn't exist" action={<a className="btn" href={href('groups')}>Back to groups</a>}>
          It may have been deleted.
        </Empty>
      </Page>
    )
  }

  const members = [...group.members].sort((a, b) => a.key - b.key)
  const dupKeys = members.filter((m, i) => members.findIndex((o) => o.key === m.key) !== i).map((m) => m.key)
  const rules = [...new Set(getStreams().flatMap((s) => Object.entries(s.tags).map(([tag, value]) => `${tag}=${value}`)))].sort()
  const waiting = group.rule ? matchingStreams(group.rule).filter((s) => !group.members.some((m) => m.streamId === s.id)) : []
  const addable = getStreams().filter((s) => !group.members.some((m) => m.streamId === s.id))

  const markChanged = () => setRestarted(false)

  return (
    <Page
      title={group.name}
      subtitle="Edit the streams in this group."
      actions={
        <>
          <a className="btn" href={href('groups')}>
            Back to groups
          </a>
          <button className="primary" onClick={() => { actions.openGroup(group.id); go(`replay/${group.id}`) }}>
            <Icon name="play" size={14} fill /> Open replay
          </button>
        </>
      }
    >
      <div className="form-row">
        <label className="field">
          <span>Name</span>
          <input type="text" value={group.name} onChange={(e) => { actions.updateGroup(group.id, { name: e.target.value }); markChanged() }} />
        </label>
        <label className="field">
          <span>Streams join</span>
          <select
            value={group.rule ? `${group.rule.tag}=${group.rule.value}` : ''}
            onChange={(e) => {
              const v = e.target.value
              const [tag, ...rest] = v.split('=')
              actions.updateGroup(group.id, { rule: v && tag ? { tag, value: rest.join('=') } : null })
              markChanged()
            }}
          >
            <option value="">Only the ones listed here</option>
            {rules.map((r) => (
              <option key={r} value={r}>
                Any stream with {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      {waiting.length > 0 && (
        <p className="notice">
          {waiting.length} stream{waiting.length === 1 ? '' : 's'} match{waiting.length === 1 ? 'es' : ''} the rule but {waiting.length === 1 ? 'is' : 'are'} not in the group yet.{' '}
          <button className="link" onClick={() => { actions.addMembers(group.id, waiting); markChanged() }}>
            Add {waiting.length === 1 ? 'it' : 'them'}
          </button>
        </p>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Label</th>
            <th>Stream</th>
            <th>Offset</th>
            <th>State</th>
            <th>
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const s = streamById(m.streamId)
            return (
              <tr key={m.streamId}>
                <td>
                  <input aria-label={`Key for ${m.label}`} className="key-input" type="number" min={1} value={m.key} onChange={(e) => { const k = parseInt(e.target.value, 10); if (k >= 1) { actions.setMember(group.id, m.streamId, { key: k }); markChanged() } }} />
                </td>
                <td>
                  <input aria-label={`Label for ${m.label}`} type="text" value={m.label} onChange={(e) => { actions.setMember(group.id, m.streamId, { label: e.target.value }); markChanged() }} />
                </td>
                <td className="muted">{s ? `${s.label} · ${s.format}` : 'Not in the store'}</td>
                <td>
                  <input aria-label={`Offset in milliseconds for ${m.label}`} className="offset" type="number" value={m.offsetMs} onChange={(e) => { const o = parseInt(e.target.value, 10); if (!Number.isNaN(o)) { actions.setMember(group.id, m.streamId, { offsetMs: o }); markChanged() } }} /> <span className="muted">ms</span>
                </td>
                <td>{s ? <RecordedState stream={s} now={now} /> : <span className="muted">Missing</span>}</td>
                <td>
                  <button className="icon-btn" aria-label={`Remove ${m.label}`} onClick={() => { actions.removeMember(group.id, m.streamId); markChanged() }}>
                    <Icon name="x" size={14} />
                  </button>
                </td>
              </tr>
            )
          })}
          {members.length === 0 && (
            <tr>
              <td colSpan={6} className="muted center">
                This group has no streams. Add one below.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {dupKeys.length > 0 && (
        <p className="error" role="alert">
          Two streams share key {[...new Set(dupKeys)].join(', ')}. Give each its own key.
        </p>
      )}

      <div className="add-row">
        <label className="field-inline">
          <span className="sr-only">Add a stream</span>
          <select value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add a stream…</option>
            {addable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({Object.entries(s.tags).map(([k, v]) => `${k}=${v}`).join(', ') || 'no tags'})
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            const s = addable.find((x) => x.id === adding)
            if (s) {
              actions.addMembers(group.id, [s])
              setAdding('')
              markChanged()
            }
          }}
        >
          Add
        </button>
      </div>

      <div className="footer-note">
        <p className="muted">Changing the streams restarts this group's replay session (about 10 seconds), so do it off air.</p>
        <div className="btn-row">
          <button onClick={() => setRestarted(true)}>Restart replay session</button>
          {restarted && <span className="muted" role="status">Restart requested. This is a prototype: nothing runs yet.</span>}
        </div>
      </div>
    </Page>
  )
}
