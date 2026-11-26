import { useSyncExternalStore } from 'react'
import type { Group, Member, Output, Playlist, Settings, Stream, TagRule, UserData } from '../model'
import { fetchStreams } from './tams'

/** v2: the earlier prototype kept demo groups under v1, which point at streams that do not exist. */
const KEY = 'open-replay-studio.v2'

export const DEFAULT_MARK_TAGS = ['Goal', 'Foul', 'Offside', 'Save']

/** Ready to choose from when starting a replay: the two replay slots of the local Open Live production. */
export const DEFAULT_OUTPUTS: Output[] = [
  { id: 'out-1', name: 'Open Live replay 1', uri: 'srt://127.0.0.1:5030?mode=caller' },
  { id: 'out-2', name: 'Open Live replay 2', uri: 'srt://127.0.0.1:5031?mode=caller' },
]

function emptyUserData(): UserData {
  return { groups: [], marks: [], clips: [], playlists: [], outputs: DEFAULT_OUTPUTS, settings: { markTags: DEFAULT_MARK_TAGS, openLive: { enabled: false, url: '' } } }
}

function load(): UserData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = JSON.parse(raw) as UserData & { channels?: { id: string; name: string; outputUri: string }[] }
      // An earlier version kept these as channels that also held a group.
      if (!saved.outputs) saved.outputs = DEFAULT_OUTPUTS
      delete saved.channels
      return saved
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

/** What components see: the user's data and the store together, so either changing re-renders them. */
type Snapshot = UserData & { store: StoreState }
let snapshot: Snapshot = { ...data, store }
const publish = () => {
  snapshot = { ...data, store }
  listeners.forEach((l) => l())
}

function set(next: UserData) {
  data = next
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // The studio still works without storage; the changes just do not survive a reload.
  }
  publish()
}

const update = (fn: (d: UserData) => UserData) => set(fn(data))

let timer: ReturnType<typeof setInterval> | undefined
let reading = false
const REFRESH_MS = 5_000

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
  }
  return () => {
    listeners.delete(l)
    if (listeners.size === 0) clearInterval(timer)
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
    update((d) => ({
      ...d,
      groups: d.groups.filter((g) => g.id !== id),
      marks: d.marks.filter((m) => m.groupId !== id),
      clips: d.clips.filter((c) => c.groupId !== id),
    }))
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
    update((d) => ({ ...d, clips: d.clips.map((c) => (c.id === clipId ? { ...c, starred: !c.starred } : c)) }))
  },
  deleteClip(clipId: string) {
    update((d) => ({
      ...d,
      clips: d.clips.filter((c) => c.id !== clipId),
      playlists: d.playlists.map((p) => ({ ...p, items: p.items.filter((i) => i.clipId !== clipId) })),
    }))
  },
  clipFromMark(markId: string) {
    update((d) => {
      const mark = d.marks.find((m) => m.id === markId)
      const group = mark && d.groups.find((g) => g.id === mark.groupId)
      const first = group?.members[0]
      if (!mark || !first) return d
      const clip = { id: newId('c'), groupId: mark.groupId, name: mark.name, streamId: first.streamId, at: mark.at, durationMs: 10_000, speed: 1, tag: mark.tag, starred: false }
      return { ...d, marks: d.marks.filter((m) => m.id !== markId), clips: [...d.clips, clip] }
    })
  },
  deleteMark(markId: string) {
    update((d) => ({ ...d, marks: d.marks.filter((m) => m.id !== markId) }))
  },

  createPlaylist(name: string): string {
    const id = newId('p')
    update((d) => ({ ...d, playlists: [...d.playlists, { id, name, items: [] }] }))
    return id
  },
  updatePlaylist(id: string, patch: Partial<Pick<Playlist, 'name'>>) {
    update((d) => ({ ...d, playlists: d.playlists.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  },
  deletePlaylist(id: string) {
    update((d) => ({ ...d, playlists: d.playlists.filter((p) => p.id !== id) }))
  },
  addItem(playlistId: string, clipId: string) {
    update((d) => ({
      ...d,
      playlists: d.playlists.map((p) => {
        const clip = d.clips.find((c) => c.id === clipId)
        return p.id === playlistId && clip ? { ...p, items: [...p.items, { clipId, speed: clip.speed }] } : p
      }),
    }))
  },
  removeItem(playlistId: string, index: number) {
    update((d) => ({ ...d, playlists: d.playlists.map((p) => (p.id === playlistId ? { ...p, items: p.items.filter((_, i) => i !== index) } : p)) }))
  },
  moveItem(playlistId: string, index: number, by: -1 | 1) {
    update((d) => ({
      ...d,
      playlists: d.playlists.map((p) => {
        const to = index + by
        const a = p.items[index]
        const b = p.items[to]
        if (p.id !== playlistId || !a || !b) return p
        const items = [...p.items]
        items[index] = b
        items[to] = a
        return { ...p, items }
      }),
    }))
  },
  setItemSpeed(playlistId: string, index: number, speed: number) {
    update((d) => ({ ...d, playlists: d.playlists.map((p) => (p.id === playlistId ? { ...p, items: p.items.map((it, i) => (i === index ? { ...it, speed } : it)) } : p)) }))
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

  /** Forget every group, mark, clip, playlist and output. The recordings stay in the store. */
  clearStudioData() {
    set(emptyUserData())
  },
}
