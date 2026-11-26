import { useCallback, useEffect, useState } from 'react'
import { Page } from '../app/Page'
import { href } from '../app/router'
import { Pill } from '../components/Bits'
import { App as OperatorScreen } from '../App'
import { replayStatus, startReplay, stopReplay, type ReplayStatus } from '../lib/replayApi'
import { useData } from '../state/store'
import { ADHOC_KEY } from './Streams'
import type { Member } from '../model'

function readAdhoc(): Member[] {
  try {
    const raw = sessionStorage.getItem(ADHOC_KEY)
    return raw ? ((JSON.parse(raw) as { members: Member[] }).members ?? []) : []
  } catch {
    return []
  }
}

/** Where a group is replayed: choose the output, start the replay, then drive it. */
export function Replay({ groupId }: { groupId?: string }) {
  const { groups, outputs } = useData()
  const group = groupId && groupId !== 'adhoc' ? groups.find((g) => g.id === groupId) : undefined
  const members = group ? group.members : groupId === 'adhoc' ? readAdhoc() : []
  const title = group ? group.name : groupId === 'adhoc' ? 'Unsaved selection' : 'Replay'
  const id = group?.id ?? groupId ?? ''

  const [outputId, setOutputId] = useState('')
  const [status, setStatus] = useState<ReplayStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const running = status?.running === true ? status : null
  // A running replay shows the output it really sends to; otherwise the one chosen here.
  const output = running?.srtUri ? (outputs.find((o) => o.uri.trim() === running.srtUri) ?? outputs.find((o) => o.id === outputId)) : outputs.find((o) => o.id === outputId)

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      setStatus(await replayStatus(id))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [id])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (job: () => Promise<ReplayStatus>) => {
    setBusy(true)
    setError('')
    try {
      setStatus(await job())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const start = () => {
    if (!output) return setError('Choose an output first.')
    if (!output.uri.trim()) return setError(`${output.name} has no SRT address yet. Set one under Outputs.`)
    void run(() => startReplay(id, title, output.uri.trim(), members))
  }

  return (
    <Page
      fill={Boolean(running && !running.outdated)}
      title={title}
      subtitle={members.length > 0 ? `${members.length} stream${members.length === 1 ? '' : 's'}: ${[...members].sort((a, b) => a.key - b.key).map((m) => `${m.key} ${m.label}`).join(' · ')}` : undefined}
      actions={
        <>
          {running && (
            <button className="danger" disabled={busy} onClick={() => run(() => stopReplay(id))}>
              Stop replay
            </button>
          )}
          <a className="btn" href={href('groups')}>
            Back to groups
          </a>
        </>
      }
    >
      {running && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {/* Choosing an output and starting is only needed while the replay is stopped. */}
      {!running && (
      <section className="panel">
        <div className="card-head">
          <h2>Replay</h2>
          <Pill>Stopped</Pill>
        </div>
        <div className="form-row">
          <label className="field">
            <span>Send the program to</span>
            <select value={output?.id ?? ''} disabled={busy} onChange={(e) => setOutputId(e.target.value)}>
              <option value="">{outputs.length === 0 ? 'No outputs yet' : 'Choose an output…'}</option>
              {outputs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.uri ? ` (${o.uri})` : ''}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={busy || members.length === 0 || !id || id === 'adhoc'} onClick={start}>
            {busy ? 'Starting…' : 'Start replay'}
          </button>
        </div>
        <p className="muted small">Starting builds the replay of this group (about 10 seconds). Nothing is sent until you start.</p>
        {id === 'adhoc' && (
          <p className="notice">
            A replay plays a saved group. <a href={href('streams')}>Save your selection as a group</a> to replay it.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      )}
      {running?.outdated && (
        <p className="notice">
          This replay was started with an older version of the desk, so it cannot be driven from here. Restart it
          {running.srtUri ? ` (it keeps sending to ${running.srtUri})` : ''}.{' '}
          <button className="link" disabled={busy || !running.srtUri} onClick={() => void run(() => startReplay(id, title, running.srtUri ?? '', members))}>
            Restart replay
          </button>
        </p>
      )}
      {running && !running.outdated && <OperatorScreen key={running.flowId} groupId={id} status={running} />}
    </Page>
  )
}
