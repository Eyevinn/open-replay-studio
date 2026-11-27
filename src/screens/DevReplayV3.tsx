import { useState } from 'react'
import { Page } from '../app/Page'
import { ControlsV3, StatusChipsV3, TimecodeV3 } from '../components/ReplayControlsV3'
import { PlaylistPanel } from '../components/PlaylistPanel'
import { useReplayClient, useReplayView } from '../lib/replayV3/useReplayV3'
import { useData } from '../state/store'

function Run({ baseUrl, flowId, group }: { baseUrl: string; flowId: string; group: string }) {
  const client = useReplayClient({ baseUrl, flowId, group })
  const view = useReplayView(client)
  const { playlists } = useData()
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = playlists.find((p) => p.id === activeId) ?? playlists[0]
  const groupId = `dev-${group}`
  // A stand-in camera when the mock names none, so a clip can be saved.
  const programStreamId = view.angles[0]?.sourceId ?? 'dev-camera'
  return (
    <div className="app">
      <div className="replay-body">
        <main>
          <TimecodeV3
            client={client}
            lead={
              <>
                <h2>Replay v3</h2>
                <StatusChipsV3 client={client} />
              </>
            }
          />
        </main>
        <PlaylistPanel group={{ id: groupId, name: 'Dev replay', members: [], rule: null, createdAt: 0, lastOpenedAt: null }} activeId={active?.id ?? null} onActive={setActiveId} onClose={() => undefined} />
      </div>
      <ControlsV3 client={client} groupId={groupId} programStreamId={programStreamId} addTo={active ? { id: active.id, name: active.name } : null} />
    </div>
  )
}

/** The v3 controls on their own, against any Strom replay API v3: the mock (scripts/mock-replay-v3.mjs) or a real Strom. */
export function DevReplayV3() {
  const [base, setBase] = useState('http://localhost:4010')
  const [flow, setFlow] = useState('mock')
  const [group, setGroup] = useState('mock')
  const [go, setGo] = useState<{ base: string; flow: string; group: string } | null>(null)
  return (
    <Page title="Replay controls, v3" subtitle="The controls against a Strom replay API v3, without the videos. Start the mock with: node scripts/mock-replay-v3.mjs">
      <div className="dev-bar">
        <label className="field-inline">
          Address <input type="text" value={base} onChange={(e) => setBase(e.target.value)} />
        </label>
        <label className="field-inline">
          Flow <input type="text" value={flow} onChange={(e) => setFlow(e.target.value)} />
        </label>
        <label className="field-inline">
          Group <input type="text" value={group} onChange={(e) => setGroup(e.target.value)} />
        </label>
        <button className="primary" onClick={() => setGo({ base, flow, group })}>
          Connect
        </button>
      </div>
      {go && <Run key={`${go.base}|${go.flow}|${go.group}`} baseUrl={go.base} flowId={go.flow} group={go.group} />}
    </Page>
  )
}
