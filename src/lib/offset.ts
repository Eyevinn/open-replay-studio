// How far the cursor is behind live, smoothed.
//
// Strom learns about new segments by polling, so its live edge (`live_frame`) moves in
// steps of one segment while the cursor moves smoothly. Read raw, "behind live" is a sawtooth
// as tall as a segment. Between polls the edge really keeps moving at real time, so this
// tracker does the same: it runs the edge forward with the clock, snaps it up when Strom
// reports a later edge, and never lets it run more than `maxLeadMs` past what Strom has
// reported (writing has stalled if the edge is that late, and the lag should then show).
// This is the approach live players use for the edge of a growing stream.

export type Sample = {
  /** Local time of the sample, in ms. */
  atMs: number
  /** Cursor, in frames. */
  frame: number
  /** Live edge as Strom last reported it, in frames. */
  liveFrame: number
  /** Duration of one frame, in ms. */
  frameMs: number
}

export class OffsetTracker {
  private edge: number | null = null // smoothed live edge, in frames
  private at = 0
  private frame = 0
  private frameMs = 40

  constructor(
    /** Where Strom's `live` command parks the cursor behind the edge. */
    private readonly marginMs: number,
    private readonly maxLeadMs = 1500,
  ) {}

  update(s: Sample) {
    if (s.frameMs <= 0) return
    if (this.edge === null) {
      this.edge = s.liveFrame
    } else {
      this.edge += (s.atMs - this.at) / s.frameMs
      this.edge = Math.min(Math.max(this.edge, s.liveFrame), s.liveFrame + this.maxLeadMs / s.frameMs)
    }
    this.at = s.atMs
    this.frame = s.frame
    this.frameMs = s.frameMs
  }

  /** The smoothed live edge in frames, or null before the first sample. */
  edgeFrame(): number | null {
    return this.edge
  }

  /** Ms the cursor is behind the live position (the edge minus the margin); never negative. */
  offsetMs(): number {
    if (this.edge === null) return 0
    return Math.max(0, (this.edge - this.frame) * this.frameMs - this.marginMs)
  }
}
