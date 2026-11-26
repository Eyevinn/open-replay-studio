// The Studio talks to a controller: it sends playhead commands and receives state.
// The real controller will speak to the Open Replay backend (API not designed yet).
// MockController stands in until then and lets the UI run on its own.

export const WINDOW_MS = 10_000 // how far back the operator can jump (cache window)

export type ReplayState = {
  /** How far behind live the multiview is playing, in ms. 0 = live. */
  offsetMs: number
  connected: boolean
}

/** The playhead's wall-clock time (UTC, in ms) and the frame rate its frames are counted at. */
export type Clock = { utcMs: number; fps: number }

export interface ReplayController {
  getState(): ReplayState
  subscribe(listener: (s: ReplayState) => void): () => void
  /** Jump to an absolute offset behind live (clamped to the cache window). */
  setOffset(ms: number): void
  /** Jump further back relative to the current position. */
  jumpBack(ms: number): void
  goLive(): void
  /** Where the playhead is on the wall clock right now, or null before it is known. */
  clock(): Clock | null
}

export class MockController implements ReplayController {
  private state: ReplayState = { offsetMs: 0, connected: true }
  private listeners = new Set<(s: ReplayState) => void>()

  getState() {
    return this.state
  }

  subscribe(listener: (s: ReplayState) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setOffset(ms: number) {
    this.set(Math.min(WINDOW_MS, Math.max(0, Math.round(ms))))
  }

  jumpBack(ms: number) {
    this.setOffset(this.state.offsetMs + ms)
  }

  goLive() {
    this.set(0)
  }

  clock(): Clock {
    return { utcMs: Date.now() - this.state.offsetMs, fps: 25 }
  }

  private set(offsetMs: number) {
    if (offsetMs === this.state.offsetMs) return
    this.state = { ...this.state, offsetMs }
    this.listeners.forEach((l) => l(this.state))
  }
}
