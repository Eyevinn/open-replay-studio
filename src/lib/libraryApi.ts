import type { Clip, Mark, Playlist } from '../model'
import { api } from './api'

/**
 * The library on the Open Replay API: marks, clips and playlists.
 *
 * Times are on the group's axis, the same as Strom's replay API. Strom applies each camera's sync
 * offset itself, so nothing here converts them.
 */

interface MarkDoc { id: string; groupId: string; name: string; t: string; utcMs?: number; tag: string | null }
interface ClipDoc { id: string; groupId: string; name: string; streamId: string; inT: string; outT: string; utcMs?: number; speed: number; tag: string | null; starred: boolean }
interface PlaylistDoc { id: string; name: string; groupId?: string; items: { clipId: string; speed: number }[]; endAction?: Playlist['endAction'] }

/** TAI runs ahead of UTC by this much (leap seconds). Only used to show a time for an item the API holds no wall clock for. */
const TAI_AHEAD_OF_UTC_MS = 37_000
const approxUtcMs = (t: string) => Number(BigInt(t) / 1_000_000n) - TAI_AHEAD_OF_UTC_MS

export const libraryId = (kind: 'mark' | 'clip' | 'playlist') => `${kind}:${crypto.randomUUID()}`

const markToApi = (m: Mark): MarkDoc => ({ id: m.id, groupId: m.groupId, name: m.name, t: m.t, utcMs: m.at, tag: m.tag })
const markFromApi = (d: MarkDoc): Mark => ({ id: d.id, groupId: d.groupId, name: d.name, t: d.t, at: d.utcMs ?? approxUtcMs(d.t), tag: d.tag })

const clipToApi = (c: Clip): ClipDoc => ({
  id: c.id, groupId: c.groupId, name: c.name, streamId: c.streamId,
  inT: c.inT, outT: c.outT,
  utcMs: c.at, speed: c.speed, tag: c.tag, starred: c.starred,
})
const clipFromApi = (d: ClipDoc): Clip => {
  const { inT, outT } = d
  return {
    id: d.id, groupId: d.groupId, name: d.name, streamId: d.streamId,
    inT, outT, at: d.utcMs ?? approxUtcMs(inT),
    durationMs: Number((BigInt(outT) - BigInt(inT)) / 1_000_000n),
    speed: d.speed, tag: d.tag, starred: d.starred,
  }
}

const playlistToApi = (p: Playlist): Omit<PlaylistDoc, 'groupId'> => ({ id: p.id, name: p.name, items: p.items, ...(p.endAction ? { endAction: p.endAction } : {}) })
const playlistFromApi = (d: PlaylistDoc): Playlist => ({ id: d.id, name: d.name, items: d.items, endAction: d.endAction ?? 'freeze' })

const del = (path: string) => api<null>(path, { method: 'DELETE' })

export const libraryApi = {
  /** Everything the library holds, in the Studio's shapes. */
  async load(): Promise<{ marks: Mark[]; clips: Clip[]; playlists: Playlist[] }> {
    const [marks, clips, playlists] = await Promise.all([
      api<MarkDoc[]>('/marks?limit=1000'),
      api<ClipDoc[]>('/clips?limit=1000'),
      api<PlaylistDoc[]>('/playlists?limit=1000'),
    ])
    return {
      marks: marks.map(markFromApi),
      clips: clips.map(clipFromApi),
      playlists: playlists.map(playlistFromApi),
    }
  },

  createMark: (m: Mark) => api<MarkDoc>('/marks', { method: 'POST', json: markToApi(m) }),
  deleteMark: (id: string) => del(`/marks/${encodeURIComponent(id)}`),

  createClip: (c: Clip) => api<ClipDoc>('/clips', { method: 'POST', json: clipToApi(c) }),
  patchClip: (id: string, patch: { starred?: boolean; name?: string; tag?: string | null; speed?: number }) =>
    api<ClipDoc>(`/clips/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch }),
  deleteClip: (id: string) => del(`/clips/${encodeURIComponent(id)}`),

  createPlaylist: (p: Playlist) => api<PlaylistDoc>('/playlists', { method: 'POST', json: playlistToApi(p) }),
  patchPlaylist: (id: string, patch: { name?: string; items?: Playlist['items']; endAction?: Playlist['endAction'] }) =>
    api<PlaylistDoc>(`/playlists/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch }),
  deletePlaylist: (id: string) => del(`/playlists/${encodeURIComponent(id)}`),
}
