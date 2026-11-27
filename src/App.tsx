import { useEffect, useMemo, useState } from 'react'
import { StromController } from './lib/stromController'
import { useReplayState } from './lib/useReplay'
import { Desk } from './components/Desk'
import { Timecode, Transport } from './components/Transport'
import { ControlsV3, StatusChipsV3, TimecodeV3 } from './components/ReplayControlsV3'
import { useMixer, type TakeParts } from './lib/useMixer'
import { useReplayApi, useReplayClient, useReplayView } from './lib/replayV3/useReplayV3'
import { Icon } from './app/icons'
import { PlaylistPanel } from './components/PlaylistPanel'
import { useData } from './state/store'
import type { ReplayStatus } from './lib/replayApi'

type Running = Extract<ReplayStatus, { running: true }>

/** A yes/no kept in this browser, for something like whether a panel is open. Works without storage. */
function useStoredFlag(key: string, initially: boolean): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      const kept = localStorage.getItem(key)
      return kept === null ? initially : kept === '1'
    } catch {
      return initially
    }
  })
  return [
    on,
    (v) => {
      setOn(v)
      try {
        localStorage.setItem(key, v ? '1' : '0')
      } catch {
        // Not kept; it still works for now.
      }
    },
  ]
}

const TakeGroup = ({ m }: { m: TakeParts }) => (
  <div className="take-group">
    <div className="on-air">
      <span className="tag tag-pgm">PGM</span> {m.program?.label ?? 'Black'}
    </div>
    <button className="take" disabled={!m.canTake} onClick={m.onTake} title="Send the preview out as program (Enter)">
      Take{m.preview && m.canTake ? <small>{m.preview.label}</small> : null}
    </button>
  </div>
)

/** The operator screen of one running replay. It speaks to Strom's replay API in whichever version Strom has. */
export function App({ groupId, status }: { groupId: string; status: Running }) {
  const api = useReplayApi(status.stromUrl)
  if (!api) return <p className="muted">Connecting to the replay…</p>
  return api.version >= 2 ? <AppV3 groupId={groupId} status={status} /> : <AppV1 groupId={groupId} status={status} />
}

/** Strom's first replay API: frames and a flat state. Kept working until Strom deploys v3. */
function AppV1({ groupId, status }: { groupId: string; status: Running }) {
  const controller = useMemo(() => new StromController({ stromUrl: status.stromUrl, group: status.group, liveMarginMs: status.liveMarginMs }), [status.stromUrl, status.group, status.liveMarginMs])
  useEffect(() => () => controller.dispose(), [controller])
  const { offsetMs, connected } = useReplayState(controller)
  const m = useMixer(groupId, status)

  return (
    <div className="app">
      <main>
        {m.error && (
          <p className="error" role="alert">
            {m.error}
          </p>
        )}
        <Timecode
          controller={controller}
          lead={
            <>
              <h2>Replay</h2>
              <div className="status">
                <span className={connected ? 'chip chip-ok' : 'chip'}>{connected ? 'Connected' : 'Offline'}</span>
                <span className={offsetMs === 0 ? 'chip' : 'chip chip-replay'}>{offsetMs === 0 ? 'Live' : 'Replay'}</span>
              </div>
            </>
          }
        />
        <Desk status={status} mixer={m.mixer} busy={m.busy} onPreview={m.onPreview} />
      </main>
      <footer className="controls" aria-label="Replay controls">
        <Transport controller={controller}>
          <TakeGroup m={m} />
        </Transport>
      </footer>
    </div>
  )
}

/** Strom's replay API v3: exact times, typed state, events with reasons, and the controls for marks, clips and cues. */
function AppV3({ groupId, status }: { groupId: string; status: Running }) {
  const client = useReplayClient({ baseUrl: status.stromUrl, flowId: status.flowId, group: status.group })
  const m = useMixer(groupId, status)
  const { groups, playlists } = useData()
  // A replay whose group this browser does not know (deleted, or made in another browser) still gets its playlists.
  const group = groups.find((g) => g.id === groupId) ?? { id: groupId, name: 'This replay', members: [], rule: null, createdAt: 0, lastOpenedAt: null }
  const [panelOpen, setPanelOpen] = useStoredFlag('open-replay-studio.playlist-panel', window.innerWidth >= 1100) // open at first on a screen wide enough to spare the room
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = playlists.find((p) => p.id === activeId) ?? playlists[0]
  // The program source's stream, for a clip cut now: the flow's players are in the order of the group's members.
  // The replay reports each angle's camera, in the order of the mixer inputs; the group's members are the fallback. A clip player on air is no camera.
  const view = useReplayView(client)
  const onAir = m.mixer.program ?? 0
  const programStreamId = view.angles[onAir]?.sourceId ?? (onAir < status.sources.length ? group.members[onAir]?.streamId : undefined) ?? ''

  return (
    <div className="app">
      <div className="replay-body">
        <main>
          {m.error && (
            <p className="error" role="alert">
              {m.error}
            </p>
          )}
          <TimecodeV3
            client={client}
            lead={
              <>
                <h2>Replay</h2>
                <StatusChipsV3 client={client} />
                <button className={`panel-toggle${panelOpen ? ' on' : ''}`} aria-pressed={panelOpen} onClick={() => setPanelOpen(!panelOpen)} title="Build and play playlists beside the replay">
                  <Icon name="playlists" size={14} /> Playlists
                </button>
              </>
            }
          />
          <Desk status={status} mixer={m.mixer} busy={m.busy} onPreview={m.onPreview} />
        </main>
        {panelOpen && <PlaylistPanel group={group} activeId={active?.id ?? null} onActive={setActiveId} onClose={() => setPanelOpen(false)} />}
      </div>
      <footer className="controls">
        <ControlsV3 client={client} groupId={groupId} programStreamId={programStreamId} addTo={active ? { id: active.id, name: active.name } : null}>
          <TakeGroup m={m} />
        </ControlsV3>
      </footer>
    </div>
  )
}
