import { Page } from '../app/Page'
import { Icon } from '../app/icons'
import { actions, useData } from '../state/store'

const valid = (uri: string) => uri.trim() === '' || /^srt:\/\/\S+$/.test(uri.trim())

/** The places a replay's program can go. Pick one when you start a group. */
export function Outputs() {
  const { outputs, settings } = useData()

  return (
    <Page
      title="Outputs"
      subtitle="Where a replay can send its program. Any SRT receiver will do. You choose one when you start a group."
      actions={
        <button onClick={() => actions.addOutput()}>
          <Icon name="plus" size={14} /> Add output
        </button>
      }
    >
      {outputs.length === 0 && <p className="muted">No outputs yet. Add one to send a replay out.</p>}
      <div className="cards">
        {outputs.map((o) => (
          <article key={o.id} className="card">
            <div className="card-head">
              <h2>
                <input aria-label={`Name of ${o.name}`} className="inline-title" type="text" value={o.name} onChange={(e) => actions.updateOutput(o.id, { name: e.target.value })} />
              </h2>
              <button className="ghost" aria-label={`Remove ${o.name}`} onClick={() => actions.removeOutput(o.id)}>
                <Icon name="trash" size={16} />
              </button>
            </div>
            <label className="field">
              <span>SRT address</span>
              <input type="text" value={o.uri} placeholder="srt://receiver.example:5030?mode=caller" onChange={(e) => actions.updateOutput(o.id, { uri: e.target.value })} />
            </label>
            {!valid(o.uri) && (
              <p className="error" role="alert">
                Use an SRT address, such as srt://receiver.example:5030?mode=caller.
              </p>
            )}
          </article>
        ))}
      </div>
      <p className="hint">
        {settings.openLive.enabled
          ? 'Open Live is linked. Point an output at an SRT source in your Open Live production to take the replay on air.'
          : 'To take a replay on air from Open Live, link it under Settings. Open Replay works without it.'}
      </p>
    </Page>
  )
}
