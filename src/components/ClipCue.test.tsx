import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Clip, Group } from '../model'

const cueClip = vi.fn()
const clearClip = vi.fn()
vi.mock('../lib/replayApi', () => ({ cueClip: (...a: unknown[]) => cueClip(...a), clearClip: (...a: unknown[]) => clearClip(...a) }))

import { ClipCue } from './ClipCue'

const group: Group = {
  id: 'g1',
  name: 'Demo',
  rule: null,
  createdAt: 0,
  lastOpenedAt: null,
  members: [
    { streamId: 'cam-1', key: 1, label: 'Camera 1', offsetMs: 0 },
    { streamId: 'cam-2', key: 2, label: 'Camera 2', offsetMs: 0 },
  ],
}
const clip: Clip = { id: 'clip:1', groupId: 'g1', name: 'Goal', streamId: 'cam-1', inT: '1', outT: '2', at: 0, durationMs: 1, speed: 1, tag: null, starred: false }

beforeEach(() => {
  cueClip.mockReset()
  clearClip.mockReset()
})
afterEach(cleanup)

describe('cueing a clip on player B', () => {
  it('offers the group\'s cameras and starts on the clip\'s own', () => {
    render(<ClipCue clip={clip} group={group} />)
    const select = screen.getByLabelText('Camera for Goal') as HTMLSelectElement
    expect([...select.options].map((o) => o.text)).toEqual(['Camera 1 (clip)', 'Camera 2'])
    expect(select.value).toBe('cam-1')
  })

  it('cues from the clip\'s camera and says it is in preview', async () => {
    cueClip.mockResolvedValue({ player: 'b', clipId: 'clip:1', streamId: 'cam-1', playing: false })
    render(<ClipCue clip={clip} group={group} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cue Goal on B' }))
    expect(await screen.findByText('Cued on B from Camera 1, in preview')).toBeTruthy()
    expect(cueClip).toHaveBeenCalledWith('g1', 'clip:1', { streamId: 'cam-1', play: false })
  })

  it('plays from another camera at the same range when that camera is chosen', async () => {
    cueClip.mockResolvedValue({ player: 'b', clipId: 'clip:1', streamId: 'cam-2', playing: true })
    render(<ClipCue clip={clip} group={group} />)
    fireEvent.change(screen.getByLabelText('Camera for Goal'), { target: { value: 'cam-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Play Goal on B' }))
    expect(await screen.findByText('Playing on B from Camera 2, in preview')).toBeTruthy()
    expect(cueClip).toHaveBeenCalledWith('g1', 'clip:1', { streamId: 'cam-2', play: true })
  })

  it('shows the API\'s reason when it refuses, and no success note', async () => {
    cueClip.mockRejectedValue(new Error('This Strom cannot switch a clip player\'s source yet: it does not report the source_switch feature.'))
    render(<ClipCue clip={clip} group={group} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cue Goal on B' }))
    expect((await screen.findByRole('alert')).textContent).toContain('source_switch')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('clears the player after a cue', async () => {
    cueClip.mockResolvedValue({ player: 'b', clipId: 'clip:1', streamId: 'cam-1', playing: false })
    clearClip.mockResolvedValue({ cleared: true })
    render(<ClipCue clip={clip} group={group} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cue Goal on B' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Clear player B' }))
    expect(clearClip).toHaveBeenCalledWith('g1')
    await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('shows nothing for a group with no cameras', () => {
    const { container } = render(<ClipCue clip={clip} group={{ ...group, members: [] }} />)
    expect(container.textContent).toBe('')
  })
})
