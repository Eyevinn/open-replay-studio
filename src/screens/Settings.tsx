import { useState } from 'react'
import { Page } from '../app/Page'
import { Icon } from '../app/icons'
import { Pill } from '../components/Bits'
import { actions, useData } from '../state/store'

export function SettingsScreen() {
  const { settings, store } = useData()
  const [tag, setTag] = useState('')
  const [tagError, setTagError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  const addTag = () => {
    const t = tag.trim()
    if (!t) return setTagError('Type a tag name.')
    if (settings.markTags.some((x) => x.toLowerCase() === t.toLowerCase())) return setTagError('That tag is already there.')
    actions.updateSettings({ markTags: [...settings.markTags, t] })
    setTag('')
    setTagError('')
  }

  return (
    <Page title="Settings">
      <section className="panel">
        <h2>Store</h2>
        <p className="muted">The TAMS store that holds the recordings. Its address and access are set where the studio runs, not here.</p>
        <p>
          {store.status === 'ok' && <Pill tone="ok">Connected</Pill>}
          {store.status === 'loading' && <Pill>Connecting</Pill>}
          {store.status === 'error' && <Pill tone="bad">Not reachable</Pill>}{' '}
          <span className="muted small">
            {store.status === 'error' ? store.error : `${store.streams.length} stream${store.streams.length === 1 ? '' : 's'} with recordings`}
          </span>
        </p>
      </section>

      <section className="panel">
        <h2>Tags for marks and clips</h2>
        <p className="muted">The buttons offered when marking a moment.</p>
        <div className="chips">
          {settings.markTags.map((t) => (
            <span key={t} className="chip-key">
              {t}
              <button className="icon-btn" aria-label={`Remove tag ${t}`} onClick={() => actions.updateSettings({ markTags: settings.markTags.filter((x) => x !== t) })}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="add-row">
          <label className="field-inline">
            <span className="sr-only">New tag</span>
            <input type="text" value={tag} placeholder="Highlight" onChange={(e) => { setTag(e.target.value); setTagError('') }} onKeyDown={(e) => e.key === 'Enter' && addTag()} />
          </label>
          <button onClick={addTag}>Add tag</button>
        </div>
        {tagError && (
          <p className="error" role="alert">
            {tagError}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Integrations</h2>
        <label className="check">
          <input type="checkbox" checked={settings.openLive.enabled} onChange={(e) => actions.updateSettings({ openLive: { ...settings.openLive, enabled: e.target.checked } })} /> Link Open Live
        </label>
        <p className="muted small">Optional. Open Replay works on any TAMS store. Linking Open Live lets an output take the replay on air and read its tally.</p>
        {settings.openLive.enabled && (
          <label className="field">
            <span>Open Live address</span>
            <input type="text" value={settings.openLive.url} placeholder="https://openlive.example.com" onChange={(e) => actions.updateSettings({ openLive: { ...settings.openLive, url: e.target.value } })} />
          </label>
        )}
      </section>

      <section className="panel">
        <h2>Studio data</h2>
        <p className="muted">Groups, marks, clips, playlists and outputs are kept in this browser. The recordings are not touched.</p>
        {confirmReset ? (
          <span className="confirm">
            Forget all groups, marks, clips, playlists and outputs?
            <button className="danger" onClick={() => { actions.clearStudioData(); setConfirmReset(false) }}>
              Forget them
            </button>
            <button onClick={() => setConfirmReset(false)}>Keep my data</button>
          </span>
        ) : (
          <button onClick={() => setConfirmReset(true)}>Clear studio data</button>
        )}
      </section>
    </Page>
  )
}
