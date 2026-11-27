import type { Member } from '../model'
import { api, API_URL } from './api'

/** A source of the running replay, with its own video. */
export interface ReplaySource {
  index: number
  label: string
  /** WHEP address of this source's video. */
  url: string
}

export interface Mixer {
  /** Index of the source on air, in the order of `sources`. `null` when unknown. */
  program: number | null
  /** Index of the source in preview. */
  preview: number | null
}

/** A clip player of the replay, and the mixer input it is on (after the cameras). */
export interface ClipPlayerInput {
  player: 'a' | 'b'
  index: number
  label: string
}

export type ReplayStatus =
  | { running: false }
  | { running: true; stromUrl: string; flowId: string; state: string; group: string; previewUrl: string; sources: ReplaySource[]; clipPlayers: ClipPlayerInput[]; mixer: Mixer; liveMarginMs: number; srtUri: string | null; outdated: boolean }

type Playback =
  | { running: false }
  | { running: true; flowId: string; state: string; group: string; stromPath: string; previewPath: string; sources: { index: number; label: string; path: string }[]; clipPlayers?: ClipPlayerInput[]; mixer: Mixer; liveMarginMs: number; srtUri: string | null; outdated: boolean }

/** The API hands out paths on itself; the controller and the video players want full addresses. */
const resolve = (p: Playback): ReplayStatus =>
  p.running
    ? {
        running: true,
        flowId: p.flowId,
        state: p.state,
        group: p.group,
        stromUrl: `${API_URL}${p.stromPath}`,
        previewUrl: `${API_URL}${p.previewPath}`,
        sources: p.sources.map((s) => ({ index: s.index, label: s.label, url: `${API_URL}${s.path}` })),
        mixer: p.mixer,
        clipPlayers: p.clipPlayers ?? [],
        liveMarginMs: p.liveMarginMs,
        srtUri: p.srtUri,
        outdated: p.outdated,
      }
    : p

const path = (groupId: string) => `/groups/${encodeURIComponent(groupId)}/playback`

export const replayStatus = async (groupId: string) => resolve(await api<Playback>(path(groupId)))

/** Start the replay of a group: its sources side by side, the program going out over SRT to `srtUri`. */
export const startReplay = async (groupId: string, name: string, srtUri: string, members: Pick<Member, 'streamId' | 'label'>[]) =>
  resolve(await api<Playback>(path(groupId), { method: 'PUT', json: { name, srtUri, members } }))

export const stopReplay = async (groupId: string) => resolve(await api<Playback>(path(groupId), { method: 'DELETE' }))

/** Put a source in preview. It stays off air until it is taken. */
export const setPreview = (groupId: string, source: number) => api<Mixer>(`${path(groupId)}/preview`, { method: 'PUT', json: { source } })

/** Send the source in preview out as the program. */
export const take = (groupId: string) => api<Mixer>(`${path(groupId)}/take`, { method: 'POST' })

// ---- Clips and playlists on the clip players of a group's replay ----
// A replay flow gets its clip players (A and B) in a later version; until then these answer 409 and say so.

export type PlayerId = 'a' | 'b'

/** A playlist as the backend's runner is playing it. */
export interface PlaylistRun {
  running: boolean
  state?: 'running' | 'finished' | 'stopped' | 'failed'
  playlistId?: string
  /** The item playing, from 0. */
  index?: number | null
  total?: number
  queued?: number
  round?: number
  /** Clips the playlist names that no longer exist; they are left out. */
  skipped?: string[]
  error?: string
}

const player = (p: PlayerId) => `?player=${p}`

export const playlistRun = (groupId: string, p: PlayerId = 'a') => api<PlaylistRun>(`${path(groupId)}/playlist${player(p)}`)
export const playPlaylist = (groupId: string, playlistId: string, p: PlayerId = 'a') =>
  api<PlaylistRun>(`${path(groupId)}/playlist${player(p)}`, { method: 'PUT', json: { playlistId } })
export const stopPlaylist = (groupId: string, p: PlayerId = 'a') => api<PlaylistRun>(`${path(groupId)}/playlist${player(p)}`, { method: 'DELETE' })

/** Put a clip on a clip player: from its own camera, or another camera at the same range. It waits on its first frame unless `play`. */
export const cueClip = (groupId: string, clipId: string, o: { streamId?: string; play?: boolean; player?: PlayerId } = {}) =>
  api<{ player: PlayerId; clipId: string; streamId: string; playing: boolean }>(`${path(groupId)}/clip${player(o.player ?? 'b')}`, {
    method: 'PUT',
    json: { clipId, ...(o.streamId ? { streamId: o.streamId } : {}), play: o.play ?? false },
  })
export const clearClip = (groupId: string, p: PlayerId = 'b') => api<{ cleared: boolean }>(`${path(groupId)}/clip${player(p)}`, { method: 'DELETE' })
