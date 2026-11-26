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

export type ReplayStatus =
  | { running: false }
  | { running: true; stromUrl: string; flowId: string; state: string; group: string; previewUrl: string; sources: ReplaySource[]; mixer: Mixer; srtUri: string | null; outdated: boolean }

type Playback =
  | { running: false }
  | { running: true; flowId: string; state: string; group: string; stromPath: string; previewPath: string; sources: { index: number; label: string; path: string }[]; mixer: Mixer; srtUri: string | null; outdated: boolean }

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
