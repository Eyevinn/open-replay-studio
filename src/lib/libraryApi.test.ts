import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Clip, Mark, Playlist } from '../model'
import { libraryApi, libraryId } from './libraryApi'

/** A fetch that answers from a table of paths, and remembers what it was sent. */
function stubFetch(answers: Record<string, unknown>) {
  const sent: { url: string; method: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const path = new URL(url).pathname.replace('/api/v1', '') + new URL(url).search
      sent.push({ url: path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined })
      const hit = Object.entries(answers).find(([p]) => path.startsWith(p))
      return new Response(JSON.stringify(hit ? hit[1] : {}), { status: hit ? 200 : 404 })
    }),
  )
  return sent
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

describe('the library on the API', () => {
  it('reads marks, clips and playlists into the studio\'s shapes, with times left on the group axis', async () => {
    stubFetch({
      '/marks': [{ id: 'mark:1', groupId: 'g1', name: 'Offside', t: '1800000000123456789', utcMs: 1799999963123, tag: 'Offside' }],
      '/clips': [{ id: 'clip:1', groupId: 'g1', name: 'Goal', streamId: 'cam-1', inT: '1800000000000000000', outT: '1800000008000000000', utcMs: 1799999963000, speed: 0.5, tag: null, starred: true }],
      '/playlists': [{ id: 'playlist:1', name: 'Highlights', items: [{ clipId: 'clip:1', speed: 0.5 }], endAction: 'loop' }],
    })
    const lib = await libraryApi.load()
    expect(lib.marks[0]).toMatchObject({ id: 'mark:1', t: '1800000000123456789', at: 1799999963123, tag: 'Offside' })
    expect(lib.clips[0]).toMatchObject({ inT: '1800000000000000000', outT: '1800000008000000000', durationMs: 8000, speed: 0.5, starred: true })
    expect(lib.playlists[0]).toEqual({ id: 'playlist:1', name: 'Highlights', items: [{ clipId: 'clip:1', speed: 0.5 }], endAction: 'loop' })
  })

  it('shows a wall-clock time for an item the API holds none for, 37 s behind the axis', async () => {
    stubFetch({ '/marks': [{ id: 'mark:2', groupId: 'g1', name: 'm', t: '1800000000000000000', tag: null }], '/clips': [], '/playlists': [] })
    const lib = await libraryApi.load()
    expect(lib.marks[0]?.at).toBe(1_800_000_000_000 - 37_000)
  })

  it('defaults a playlist\'s end action to freeze', async () => {
    stubFetch({ '/marks': [], '/clips': [], '/playlists': [{ id: 'playlist:3', name: 'P', items: [] }] })
    expect((await libraryApi.load()).playlists[0]?.endAction).toBe('freeze')
  })

  it('sends a new clip with its own id and its group-axis range unchanged', async () => {
    const sent = stubFetch({ '/clips': {} })
    const clip: Clip = { id: libraryId('clip'), groupId: 'g1', name: 'Goal', streamId: 'cam-1', inT: '1800000000000000000', outT: '1800000008000000000', at: 1_799_999_963_000, durationMs: 8000, speed: 0.5, tag: null, starred: false }
    await libraryApi.createClip(clip)
    expect(clip.id).toMatch(/^clip:[0-9a-f-]{36}$/)
    expect(sent[0]).toMatchObject({ url: '/clips', method: 'POST' })
    expect(sent[0]?.body).toMatchObject({ id: clip.id, groupId: 'g1', streamId: 'cam-1', inT: clip.inT, outT: clip.outT, speed: 0.5, utcMs: clip.at })
  })

  it('sends a mark with its exact time and a playlist with its entries and end action', async () => {
    const sent = stubFetch({ '/marks': {}, '/playlists': {} })
    const mark: Mark = { id: 'mark:9', groupId: 'g1', name: 'm', t: '123', at: 5, tag: 'Goal' }
    const playlist: Playlist = { id: 'playlist:9', name: 'P', items: [{ clipId: 'clip:1', speed: 1 }], endAction: 'live' }
    await libraryApi.createMark(mark)
    await libraryApi.createPlaylist(playlist)
    expect(sent[0]?.body).toMatchObject({ id: 'mark:9', t: '123', utcMs: 5, tag: 'Goal' })
    expect(sent[1]?.body).toMatchObject({ id: 'playlist:9', items: [{ clipId: 'clip:1', speed: 1 }], endAction: 'live' })
  })

  it('turns an error reply into a thrown message, preferring the detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Bad Request', message: 'body/t TAI nanoseconds as a decimal string' }), { status: 400 })))
    await expect(libraryApi.createMark({ id: 'mark:x', groupId: 'g', name: 'm', t: 'abc', at: 1, tag: null })).rejects.toThrow('body/t TAI nanoseconds as a decimal string')
  })
})
