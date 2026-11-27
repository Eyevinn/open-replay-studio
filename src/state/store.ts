import { useSyncExternalStore } from 'react'
import type { Clip, Group, Mark, Member, Output, Playlist, Settings, Stream, TagRule, UserData } from '../model'
import { fetchStreams } from './tams'
import { ApiError } from '../lib/api'
import { libraryApi, libraryId } from '../lib/libraryApi'
import { addMs } from '../lib/replayV3/ns'

/** v2: the earlier prototype kept demo groups under v1, which point at streams that do not exist. */
const KEY = 'open-replay-studio.v2'
/** Marks, clips and playlists used to live in this browser; they now live on the API. A copy of the old ones is kept here. */
const BACKUP_KEY = 'open-replay-studio.v2.library-backup'

export const DEFAULT_MARK_TAGS = ['Goal', 'Foul', 'Offside', 'Save']

/** Ready to choose from when starting a replay: the two replay slots of the local Open Live production. */
export const DEFAULT_OUTPUTS: Output[] = [
  { id: 'out-1', name: 'Open Live replay 1', uri: 'srt://127.0.0.1:5030?mode=caller' },
  { id: 'out-2', name: 'Open Live replay 2', uri: 'srt://127.0.0.1:5031?mode=caller' },
]

function emptyUserData(): UserData {
  return { groups: [], marks: [], clips: [], playlists: [], outputs: DEFAULT_OUTPUTS, settings: { markTags: DEFAULT_MARK_TAGS, openLive: { enabled: false, url: '' } } }
}

type LibraryData = Pick<UserData, 'marks' | 'clips' | 'playlists'>
/** What this browser held before the library moved to the API, until it has been sent there. */
let legacy: LibraryData | null = null

function load(): UserData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = JSON.parse(raw) as UserData & { channels?: { id: string; name: string; outputUri: string }[] }
      // An earlier version kept these as channels that also held a group.
      if (!saved.outputs) saved.outputs = DEFAULT_OUTPUTS
      delete saved.channels
      const old = { marks: saved.marks ?? [], clips: saved.clips ?? [], playlists: saved.playlists ?? [] }
      if (old.marks.length + old.clips.length + old.playlists.length > 0) {
        legacy = old
        if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, JSON.stringify(old))
      }
      return { ...saved, marks: [], clips: [], playlists: [] }
    }
  } catch {
    // No storage, or a damaged value: start empty.
  }
  return emptyUserData()
}

let data: UserData = load()
const listeners = new Set<() => void>()

/** What the store (TAMS) holds, as last read. */
export type StoreState = { status: 'loading' | 'ok' | 'error'; streams: Stream[]; error: string; updatedAt: number | null }
let store: StoreState = { status: 'loading', streams: [], error: '', updatedAt: null }

/** Whether marks, clips and playlists have been read from the API, and what went wrong if not. */
export type LibraryState = { status: 'loading' | 'ok' | 'error'; error: string; notice: string }
let library: LibraryState = { status: 'loading', error: '', notice: '' }

/** What components see: the user's data, the store and the library state together, so any of them changing re-renders. */
type Snapshot = UserData & { store: StoreState; library: LibraryState }
let snapshot: Snapshot = { ...data, store, library }
const publish = () => {
  snapshot = { ...data, store, library }
  listeners.forEach((l) => l())
}

function set(next: UserData) {
  data = next
  try {
    // Marks, clips and playlists belong to the API; only groups, outputs and settings are kept here.
    localStorage.setItem(KEY, JSON.stringify({ ...data, marks: [], clips: [], playlists: [] }))
  } catch {
    // The studio still works without storage; the changes just do not survive a reload.
  }
  publish()
}

const update = (fn: (d: UserData) => UserData) => set(fn(data))

// ---- The library: marks, clips and playlists live on the API ----
//
// Changes show at once and are sent in the order they were made (a playlist can only name a clip
// that already exists). If one is refused, the screen is put back to what the API holds and says why.

let queue: Promise<unknown> = Promise.resolve()
let pending = 0
let needsReload = false
/** Why the last change was refused. It stays until a later change is accepted, so putting the screen back does not hide it. */
let writeError = ''

function write(op: () => Promise<unknown>) {
  pending++
  queue = queue
    .then(async () => {
      await op()
      writeError = ''
    })
    .catch((err) => {
      needsReload = true
      writeError = `A change was not saved: ${err instanceof Error ? err.message : String(err)}`
      library = { ...library, status: 'error', error: writeError }
      publish()
    })
    .finally(() => {
      pending--
      if (pending === 0 && needsReload) {
        needsReload = false
        void loadLibrary()
      }
    })
}

/**
 * Send what this browser held before the library moved, once. The new ids come from the old ones, so a
 * migration that stopped half way can run again: an id the API already has is counted as moved.
 * Items without an exact time cannot be placed and stay in the backup.
 */
async function migrateLegacy(old: LibraryData): Promise<string> {
  const legacyId = (kind: 'mark' | 'clip' | 'playlist', id: string) => `${kind}:legacy-${id.replace(/[^A-Za-z0-9-]/g, '-')}`
  /** True when the item is now on the API (created, or already there). False when the API refuses it, so it stays in the backup. */
  const once = async (create: () => Promise<unknown>): Promise<boolean> => {
    try {
      await create()
      return true
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return true
      if (err instanceof ApiError && err.status === 400) return false
      throw err // the API is down or failing: try the whole thing again later
    }
  }
  let moved = 0
  let skipped = 0
  for (const m of old.marks) {
    if (m.t && (await once(() => libraryApi.createMark({ ...m, id: legacyId('mark', m.id) })))) moved++
    else skipped++
  }
  const clipIds = new Map<string, string>()
  for (const c of old.clips) {
    const id = legacyId('clip', c.id)
    if (c.inT && c.outT && (await once(() => libraryApi.createClip({ ...c, id })))) {
      clipIds.set(c.id, id)
      moved++
    } else skipped++
  }
  for (const p of old.playlists) {
    const items = p.items.flatMap((i) => (clipIds.has(i.clipId) ? [{ ...i, clipId: clipIds.get(i.clipId)! }] : []))
    if (await once(() => libraryApi.createPlaylist({ ...p, id: legacyId('playlist', p.id), items }))) moved++
    else skipped++
  }
  return skipped > 0
    ? `Moved ${moved} items from this browser to the API. ${skipped} the API would not take (no exact time, or invalid) stayed in this browser's backup.`
    : `Moved ${moved} items from this browser to the API.`
}

/** Read the library from the API. Skipped while a change is still on its way, so it cannot undo it. */
export async function loadLibrary() {
  if (pending > 0) return
  try {
    let notice = library.notice
    if (legacy) {
      const old = legacy
      notice = await migrateLegacy(old)
      legacy = null
    }
    const lib = await libraryApi.load()
    if (pending > 0) return
    data = { ...data, ...lib }
    library = { status: 'ok', error: writeError, notice }
  } catch (err) {
    library = { ...library, status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
  publish()
}

let timer: ReturnType<typeof setInterval> | undefined
let libraryTimer: ReturnType<typeof setInterval> | undefined
let reading = false
const REFRESH_MS = 5_000
const LIBRARY_REFRESH_MS = 10_000

/** Read the store now. Keeps the last streams when a read fails, and says so. */
export async function refreshStreams() {
  if (reading) return
  reading = true
  try {
    const streams = await fetchStreams()
    store = { status: 'ok', streams, error: '', updatedAt: Date.now() }
  } catch (err) {
    store = { ...store, status: 'error', error: err instanceof Error ? err.message : String(err) }
  } finally {
    reading = false
  }
  publish()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  if (listeners.size === 1) {
    void refreshStreams()
    timer = setInterval(() => void refreshStreams(), REFRESH_MS)
    void loadLibrary()
    libraryTimer = setInterval(() => void loadLibrary(), LIBRARY_REFRESH_MS)
  }
  return () => {
    listeners.delete(l)
    if (listeners.size === 0) {
      clearInterval(timer)
      clearInterval(libraryTimer)
    }
  }
}

/** The user's data, and `store`: what the TAMS store holds. Re-renders when either changes. */
export const useData = (): Snapshot => useSyncExternalStore(subscribe, () => snapshot)

/** What the store holds, as last read. */
export const getStreams = (): Stream[] => store.streams
export const streamById = (id: string): Stream | undefined => store.streams.find((s) => s.id === id)

export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

export const ruleMatches = (s: Stream, rule: TagRule) => s.tags[rule.tag] === rule.value
export const matchingStreams = (rule: TagRule) => store.streams.filter((s) => ruleMatches(s, rule))

/** Tag pairs that every one of these streams has, as `tag=value`. */
export function commonTags(list: Stream[]): TagRule[] {
  const first = list[0]
  if (!first) return []
  return Object.entries(first.tags)
    .filter(([tag, value]) => list.every((s) => s.tags[tag] === value))
    .map(([tag, value]) => ({ tag, value }))
}

/** The tag Open Live puts on the flows of one production, and a studio group can follow. */
export const GROUP_TAG = 'replay_group'

export interface SuggestedGroup {
  name: string
  rule: TagRule
  streams: Stream[]
}

/** Streams the store tags with a group that no studio group follows yet. */
export function suggestedGroups(streams: Stream[], groups: Group[]): SuggestedGroup[] {
  const byName = new Map<string, Stream[]>()
  for (const s of streams) {
    const name = s.tags[GROUP_TAG]
    if (name) byName.set(name, [...(byName.get(name) ?? []), s])
  }
  return [...byName]
    .filter(([name]) => !groups.some((g) => g.rule?.tag === GROUP_TAG && g.rule.value === name))
    .map(([name, list]) => ({ name, rule: { tag: GROUP_TAG, value: name }, streams: sortByAngle(list) }))
}

/** Cameras in the order the producer numbered them: angle video_in_2 before video_in_10. */
export function sortByAngle(list: Stream[]): Stream[] {
  const n = (s: Stream) => Number(/(\d+)$/.exec(s.tags.angle ?? '')?.[1] ?? Infinity)
  return [...list].sort((a, b) => n(a) - n(b) || a.label.localeCompare(b.label))
}

/** The members for a set of streams: keys 1, 2, 3 in angle order, named after the source. */
export function membersFor(list: Stream[]): Member[] {
  return sortByAngle(list).map((s, i) => ({ streamId: s.id, key: i + 1, label: s.tags.source_name || s.label, offsetMs: 0 }))
}

export const isLive = (s: Stream) => s.endedAt === null
export const groupIsLive = (g: Group) => g.members.some((m) => streamById(m.streamId)?.endedAt === null)

function nextKey(members: Member[]): number {
  const used = new Set(members.map((m) => m.key))
  let k = 1
  while (used.has(k)) k++
  return k
}

const memberOf = (s: Stream, members: Member[]): Member => ({ streamId: s.id, key: nextKey(members), label: s.label, offsetMs: 0 })

/** Change a playlist's items here and on the API. */
function editItems(playlistId: string, fn: (items: Playlist['items']) => Playlist['items']) {
  const cur = data.playlists.find((p) => p.id === playlistId)
  if (!cur) return
  const items = fn(cur.items)
  if (items === cur.items) return
  update((d) => ({ ...d, playlists: d.playlists.map((p) => (p.id === playlistId ? { ...p, items } : p)) }))
  write(() => libraryApi.patchPlaylist(playlistId, { items }))
}

export const actions = {
  createGroup(name: string, members: Member[], rule: TagRule | null): string {
    const id = newId('g')
    update((d) => ({ ...d, groups: [...d.groups, { id, name, members, rule, createdAt: Date.now(), lastOpenedAt: null }] }))
    return id
  },
  updateGroup(id: string, patch: Partial<Pick<Group, 'name' | 'rule'>>) {
    update((d) => ({ ...d, groups: d.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))
  },
  openGroup(id: string) {
    update((d) => ({ ...d, groups: d.groups.map((g) => (g.id === id ? { ...g, lastOpenedAt: Date.now() } : g)) }))
  },
  deleteGroup(id: string) {
    const gone = [...data.marks.filter((m) => m.groupId === id).map((m) => () => libraryApi.deleteMark(m.id)), ...data.clips.filter((c) => c.groupId === id).map((c) => () => libraryApi.deleteClip(c.id))]
    update((d) => ({
      ...d,
      groups: d.groups.filter((g) => g.id !== id),
      marks: d.marks.filter((m) => m.groupId !== id),
      clips: d.clips.filter((c) => c.groupId !== id),
    }))
    for (const op of gone) write(op)
  },
  setMember(groupId: string, streamId: string, patch: Partial<Pick<Member, 'key' | 'label' | 'offsetMs'>>) {
    update((d) => ({
      ...d,
      groups: d.groups.map((g) =>
        g.id === groupId ? { ...g, members: g.members.map((m) => (m.streamId === streamId ? { ...m, ...patch } : m)) } : g,
      ),
    }))
  },
  removeMember(groupId: string, streamId: string) {
    update((d) => ({
      ...d,
      groups: d.groups.map((g) => (g.id === groupId ? { ...g, members: g.members.filter((m) => m.streamId !== streamId) } : g)),
    }))
  },
  addMembers(groupId: string, add: Stream[]) {
    update((d) => ({
      ...d,
      groups: d.groups.map((g) => {
        if (g.id !== groupId) return g
        const members = [...g.members]
        for (const s of add) if (!members.some((m) => m.streamId === s.id)) members.push(memberOf(s, members))
        return { ...g, members }
      }),
    }))
  },

  toggleStar(clipId: string) {
    const clip = data.clips.find((c) => c.id === clipId)
    if (!clip) return
    update((d) => ({ ...d, clips: d.clips.map((c) => (c.id === clipId ? { ...c, starred: !c.starred } : c)) }))
    write(() => libraryApi.patchClip(clipId, { starred: !clip.starred }))
  },
  deleteClip(clipId: string) {
    update((d) => ({
      ...d,
      clips: d.clips.filter((c) => c.id !== clipId),
      playlists: d.playlists.map((p) => ({ ...p, items: p.items.filter((i) => i.clipId !== clipId) })),
    }))
    write(() => libraryApi.deleteClip(clipId)) // the API also takes it out of the playlists
  },
  clipFromMark(markId: string) {
    const mark = data.marks.find((m) => m.id === markId)
    const first = mark && data.groups.find((g) => g.id === mark.groupId)?.members[0]
    if (!mark || !first) return
    const clip: Clip = { id: libraryId('clip'), groupId: mark.groupId, name: mark.name, streamId: first.streamId, at: mark.at, durationMs: 10_000, speed: 1, tag: mark.tag, starred: false, inT: mark.t, outT: addMs(mark.t, 10_000) }
    update((d) => ({ ...d, marks: d.marks.filter((m) => m.id !== markId), clips: [...d.clips, clip] }))
    write(async () => {
      await libraryApi.createClip(clip)
      await libraryApi.deleteMark(markId)
    })
  },
  addMark(mark: Omit<Mark, 'id'>): string {
    const full: Mark = { ...mark, id: libraryId('mark') }
    update((d) => ({ ...d, marks: [...d.marks, full] }))
    write(() => libraryApi.createMark(full))
    return full.id
  },
  addClip(clip: Omit<Clip, 'id'>): string {
    const full: Clip = { ...clip, id: libraryId('clip') }
    update((d) => ({ ...d, clips: [...d.clips, full] }))
    write(() => libraryApi.createClip(full))
    return full.id
  },
  deleteMark(markId: string) {
    update((d) => ({ ...d, marks: d.marks.filter((m) => m.id !== markId) }))
    write(() => libraryApi.deleteMark(markId))
  },

  createPlaylist(name: string): string {
    const playlist: Playlist = { id: libraryId('playlist'), name, items: [] }
    update((d) => ({ ...d, playlists: [...d.playlists, playlist] }))
    write(() => libraryApi.createPlaylist(playlist))
    return playlist.id
  },
  updatePlaylist(id: string, patch: Partial<Pick<Playlist, 'name' | 'endAction'>>) {
    update((d) => ({ ...d, playlists: d.playlists.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
    write(() => libraryApi.patchPlaylist(id, patch))
  },
  deletePlaylist(id: string) {
    update((d) => ({ ...d, playlists: d.playlists.filter((p) => p.id !== id) }))
    write(() => libraryApi.deletePlaylist(id))
  },
  addItem(playlistId: string, clipId: string) {
    const clip = data.clips.find((c) => c.id === clipId)
    if (!clip) return
    editItems(playlistId, (items) => [...items, { clipId, speed: clip.speed }])
  },
  removeItem(playlistId: string, index: number) {
    editItems(playlistId, (items) => items.filter((_, i) => i !== index))
  },
  moveItem(playlistId: string, index: number, by: -1 | 1) {
    editItems(playlistId, (items) => {
      const a = items[index]
      const b = items[index + by]
      if (!a || !b) return items
      const next = [...items]
      next[index] = b
      next[index + by] = a
      return next
    })
  },
  setItemSpeed(playlistId: string, index: number, speed: number) {
    editItems(playlistId, (items) => items.map((it, i) => (i === index ? { ...it, speed } : it)))
  },

  addOutput(): string {
    const id = newId('out')
    update((d) => ({ ...d, outputs: [...d.outputs, { id, name: `Output ${d.outputs.length + 1}`, uri: '' }] }))
    return id
  },
  updateOutput(id: string, patch: Partial<Omit<Output, 'id'>>) {
    update((d) => ({ ...d, outputs: d.outputs.map((o) => (o.id === id ? { ...o, ...patch } : o)) }))
  },
  removeOutput(id: string) {
    update((d) => ({ ...d, outputs: d.outputs.filter((o) => o.id !== id) }))
  },

  updateSettings(patch: Partial<Settings>) {
    update((d) => ({ ...d, settings: { ...d.settings, ...patch } }))
  },

  /** Forget every group and output and reset the settings. Marks, clips and playlists are kept by the API, and the recordings stay in the store. */
  clearStudioData() {
    set({ ...emptyUserData(), marks: data.marks, clips: data.clips, playlists: data.playlists })
  },
}
