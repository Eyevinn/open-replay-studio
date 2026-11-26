import { useState } from 'react'
import { Empty, Page } from '../app/Page'
import { go, href } from '../app/router'
import { Icon } from '../app/icons'
import { Pill } from '../components/Bits'
import { formatDuration, formatWhen } from '../lib/format'
import { useNow } from '../lib/useNow'
import { actions, groupIsLive, matchingStreams, membersFor, streamById, suggestedGroups, useData } from '../state/store'
import type { Group } from '../model'

function extent(g: Group, now: number): string {
  const streams = g.members.flatMap((m) => streamById(m.streamId) ?? [])
  if (streams.length === 0) return 'No recordings found'
  const start = Math.min(...streams.map((s) => s.startedAt))
  const live = streams.some((s) => s.endedAt === null)
  const end = live ? now : Math.max(...streams.map((s) => s.endedAt ?? now))
  return live ? `Recording for ${formatDuration(end - start)}` : `${formatWhen(start, now)} · ${formatDuration(end - start)}`
}

/** The home screen: the groups of streams the operator can open. */
export function Groups() {
  const { groups, store } = useData()
  const suggested = suggestedGroups(store.streams, groups)
  const now = useNow()
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const open = (id: string) => {
    actions.openGroup(id)
    go(`replay/${id}`)
  }

  return (
    <Page
      title="Groups"
      subtitle="A group is a set of recorded streams that share a timeline. Open one to replay it."
      actions={
        <a className="btn primary" href={href('streams')}>
          <Icon name="plus" size={16} /> New group
        </a>
      }
    >
      {store.status === 'error' && (
        <p className="notice" role="alert">
          The store could not be read: {store.error}
        </p>
      )}
      {suggested.length > 0 && (
        <>
          <h2 className="section">Found in the store</h2>
          <div className="cards">
            {suggested.map((g) => (
              <article key={g.name} className="card">
                <div className="card-head">
                  <h2>{g.name}</h2>
                  {g.streams.some((s) => s.endedAt === null) ? <Pill tone="ok">Live</Pill> : <Pill>Ended</Pill>}
                </div>
                <p className="muted">
                  {g.streams.length} stream{g.streams.length === 1 ? '' : 's'} tagged {g.rule.tag}={g.rule.value}
                </p>
                <div className="btn-row">
                  <button
                    className="primary"
                    onClick={() => {
                      const id = actions.createGroup(g.name, membersFor(g.streams), g.rule)
                      actions.openGroup(id)
                      go(`replay/${id}`)
                    }}
                  >
                    <Icon name="play" size={14} fill /> Create and open
                  </button>
                </div>
              </article>
            ))}
          </div>
          {groups.length > 0 && <h2 className="section">Your groups</h2>}
        </>
      )}
      {groups.length === 0 && suggested.length > 0 ? null : groups.length === 0 ? (
        <Empty title="Start your first group" action={<a className="btn primary" href={href('streams')}>Browse streams</a>}>
          Pick the recorded streams that belong together, such as the cameras of one match, and open them side by side.
        </Empty>
      ) : (
        <div className="cards">
          {groups.map((g) => {
            const live = groupIsLive(g)
            const fresh = g.rule ? matchingStreams(g.rule).filter((s) => !g.members.some((m) => m.streamId === s.id)).length : 0
            return (
              <article key={g.id} className="card">
                <div className="card-head">
                  <h2>{g.name}</h2>
                  {live ? <Pill tone="ok">Live</Pill> : <Pill>Ended</Pill>}
                </div>
                <p className="muted">
                  {g.members.length} stream{g.members.length === 1 ? '' : 's'} · {extent(g, now)}
                </p>
                <div className="chips">
                  {[...g.members].sort((a, b) => a.key - b.key).map((m) => (
                    <span key={m.streamId} className="chip-key">
                      <b>{m.key}</b> {m.label}
                    </span>
                  ))}
                </div>
                <p className="muted small">
                  {g.rule ? `Keeps adding streams with ${g.rule.tag}=${g.rule.value}` : 'Fixed list'}
                  {g.lastOpenedAt && ` · opened ${formatWhen(g.lastOpenedAt, now).toLowerCase()}`}
                </p>
                {fresh > 0 && (
                  <p className="notice">
                    {fresh} new stream{fresh === 1 ? '' : 's'} match{fresh === 1 ? 'es' : ''} the rule. <a href={href(`groups/${g.id}`)}>Add {fresh === 1 ? 'it' : 'them'}</a>
                  </p>
                )}
                <div className="btn-row">
                  <button className="primary" onClick={() => open(g.id)}>
                    <Icon name="play" size={14} fill /> Open replay
                  </button>
                  <a className="btn" href={href(`groups/${g.id}`)}>
                    Edit
                  </a>
                  {confirmDelete === g.id ? (
                    <span className="confirm">
                      Delete this group? The recordings stay.
                      <button
                        className="danger"
                        onClick={() => {
                          actions.deleteGroup(g.id)
                          setConfirmDelete(null)
                        }}
                      >
                        Delete group
                      </button>
                      <button onClick={() => setConfirmDelete(null)}>Keep</button>
                    </span>
                  ) : (
                    <button className="ghost" aria-label={`Delete ${g.name}`} onClick={() => setConfirmDelete(g.id)}>
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </Page>
  )
}
