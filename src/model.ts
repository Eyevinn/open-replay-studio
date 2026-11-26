// The objects of Open Replay, as ADR-0001 in the dev team repo defines them. A stream is read from a TAMS store;
// everything else is Open Replay's own data.

export type StreamId = string

/** A recorded stream found in the store (a TAMS flow with its source's label). Never stored by Open Replay. */
export interface Stream {
  id: StreamId
  label: string
  tags: Record<string, string>
  /** For example "1080p50". */
  format: string
  hasAudio: boolean
  /** When the first segment starts, epoch ms. */
  startedAt: number
  /** When the last segment ends, epoch ms. `null` while the stream is still being written. */
  endedAt: number | null
  /** How far the newest segment is behind the clock while live, in ms. */
  lagMs: number
}

export interface Member {
  streamId: StreamId
  /** The key the operator presses to pick this angle. */
  key: number
  /** Overrides the stream's own label. */
  label: string
  /** Trim added to this stream's timestamps, for writers that are not perfectly aligned. */
  offsetMs: number
}

/** A tag rule: streams with this tag value join the group by themselves. */
export interface TagRule {
  tag: string
  value: string
}

/** A named, ordered set of streams that share one timeline. A fixed list, or a tag rule. */
export interface Group {
  id: string
  name: string
  members: Member[]
  rule: TagRule | null
  createdAt: number
  lastOpenedAt: number | null
}

/** A moment on the timeline. */
export interface Mark {
  id: string
  groupId: string
  name: string
  at: number
  tag: string | null
}

/** A range on one stream, with a speed. It points into the recording and is never a copy. */
export interface Clip {
  id: string
  groupId: string
  name: string
  streamId: StreamId
  at: number
  durationMs: number
  /** 0.25 to 1. */
  speed: number
  tag: string | null
  starred: boolean
}

export interface PlaylistItem {
  clipId: string
  speed: number
}

export interface Playlist {
  id: string
  name: string
  items: PlaylistItem[]
}

/** Where a replay's program can go: a named SRT destination, such as a replay slot of an Open Live production. */
export interface Output {
  id: string
  name: string
  /** An SRT address, for example srt://127.0.0.1:5031?mode=caller. */
  uri: string
}

export interface Settings {
  /** The tags offered on marks and clips. */
  markTags: string[]
  openLive: { enabled: boolean; url: string }
}

/** What the studio keeps between visits. */
export interface UserData {
  groups: Group[]
  marks: Mark[]
  clips: Clip[]
  playlists: Playlist[]
  outputs: Output[]
  settings: Settings
}

export const SPEEDS = [0.25, 0.5, 0.75, 1] as const
