import { connectWhep, WHEP_CONNECT_DELAY_MS } from './whep'

// Reads the time burned into a picture by Strom's Reference Timestamp block (`burn_in`), and from it
// how long a frame took to get from where it was stamped to this screen.
//
// Layout, from Strom (reference_timestamp/burn_in.rs): a row of 64 cells across the full width, each
// width/64 wide and height/40 tall, at height/12 from the top. White is 1. Cell i < 52 is bit i (LSB
// first) of the UTC time in microseconds since 1970; cells 52..63 are a fixed 1,0,1,0.. sync pattern
// that must be present, or the frame is not read.
//
// Where the row sits in the program output depends on the source: the mixer fits a picture into the frame
// and keeps its aspect, so a film wider than 16:9 is letterboxed and its code row lands lower, and a
// source of another size is scaled. The row always spans the picture's width, so the cells are width/64
// across the frame (letterboxed or scaled to the frame's width), but the row's height has to be found:
// `locate` scans for the sync pattern, and the row is then read at the height it was found at.
// A picture narrower than the frame (pillarboxed) is not handled.

const CELLS = 64
const TIME_BITS = 52

type Pixels = (x: number, y: number) => number

const luma = (d: Uint8ClampedArray, i: number) => d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114

/** The cells of the row at `y`, or null when the sync pattern is not there. */
function readCells(pixel: Pixels, width: number, y: number): boolean[] | null {
  const cellW = Math.floor(width / CELLS)
  const cells: boolean[] = []
  for (let i = 0; i < CELLS; i++) cells.push(pixel(Math.floor((i + 0.5) * cellW), y) > 128)
  for (let i = TIME_BITS; i < CELLS; i++) if (cells[i] !== ((i - TIME_BITS) % 2 === 0)) return null
  return cells
}

function timeOf(cells: boolean[]): number {
  let us = 0
  for (let i = 0; i < TIME_BITS; i++) if (cells[i]) us += 2 ** i
  return us
}

// A sync-valid row is easy to hit by chance (1 in 4096 per row), so the code row is taken to be the
// longest run of consecutive rows that all read: a cell is at least ~8 px tall, noise is not.
const MIN_ROWS = 5

/** The y of the middle of the code row in a full frame, or null when there is none. */
function locate(data: Uint8ClampedArray, width: number, height: number): number | null {
  const pixel: Pixels = (x, y) => luma(data, (y * width + x) * 4)
  let best: { start: number; len: number } | null = null
  let run = 0
  for (let y = 0; y <= height; y++) {
    if (y < height && readCells(pixel, width, y)) {
      run++
    } else {
      if (run >= MIN_ROWS && (!best || run > best.len)) best = { start: y - run, len: run }
      run = 0
    }
  }
  return best ? best.start + Math.floor(best.len / 2) : null
}

export type LatencyStats = {
  /** Median delay over the recent frames, in ms. */
  medianMs: number
  p95Ms: number
  minMs: number
  maxMs: number
  /** Frames behind these numbers. */
  frames: number
}

const WINDOW_FRAMES = 150 // about 6 s at 25 fps
const STALE_MS = 3000 // no readable frame for this long: report nothing
const JUMP_US = 1_500_000 // a time further than this from the last frame's has to be confirmed

/**
 * Reads the burned-in time off the frames of a video that something else feeds, and measures, frame by frame, how long
 * each frame took from where it was stamped to this screen. Several readers of different sources of one timeline give
 * how far those sources are from each other, because what they share cancels out.
 */
export class BitstripReader {
  protected delays: number[] = []
  protected lastReadAt = 0
  protected lastUs: number | null = null // the last time accepted from the picture
  protected pendingUs: number | null = null // a time that jumped away from it, until the next frame confirms
  protected cancelled = false

  constructor(protected readonly video: HTMLVideoElement) {}

  /** Start reading the frames the video shows. */
  begin() {
    this.sample()
  }

  stats(): LatencyStats | null {
    if (performance.now() - this.lastReadAt > STALE_MS || this.delays.length === 0) return null
    const d = [...this.delays].sort((a, b) => a - b)
    const at = (p: number) => d[Math.min(d.length - 1, Math.floor(p * d.length))]!
    return { medianMs: at(0.5), p95Ms: at(0.95), minMs: d[0]!, maxMs: d[d.length - 1]!, frames: d.length }
  }

  dispose() {
    this.cancelled = true
  }

  // A cell flipped by compression gives a time that is off by seconds. Frames come in order, so a time that
  // jumps by more than JUMP_US from the last one counts only once the next frame agrees with it (a seek or a
  // source change does that; a misread does not).
  protected accept(us: number): boolean {
    const near = (a: number, b: number) => Math.abs(a - b) <= JUMP_US
    if (this.lastUs !== null && near(us, this.lastUs)) {
      this.lastUs = us
      this.pendingUs = null
      return true
    }
    if (this.pendingUs !== null && near(us, this.pendingUs)) {
      this.lastUs = us
      this.pendingUs = null
      return true
    }
    this.pendingUs = us
    return false
  }

  protected sample() {
    const frame = document.createElement('canvas')
    const strip = document.createElement('canvas')
    const frameCtx = frame.getContext('2d', { willReadFrequently: true })!
    const stripCtx = strip.getContext('2d', { willReadFrequently: true })!
    let rowY: number | null = null // middle of the code row, once found
    let size = ''
    let misses = 0
    const onFrame: VideoFrameRequestCallback = (now, meta) => {
      if (this.cancelled) return
      const w = this.video.videoWidth
      const h = this.video.videoHeight
      if (w > 0) {
        if (`${w}x${h}` !== size) {
          size = `${w}x${h}`
          rowY = null
        }
        if (rowY === null) {
          // Look for the row in the whole frame; once found, only that strip is read.
          frame.width = w
          frame.height = h
          frameCtx.drawImage(this.video, 0, 0)
          rowY = locate(frameCtx.getImageData(0, 0, w, h).data, w, h)
        }
        let us: number | null = null
        if (rowY !== null) {
          const top = Math.max(0, rowY - 2)
          strip.width = w
          strip.height = 5
          stripCtx.drawImage(this.video, 0, top, w, 5, 0, 0, w, 5)
          const d = stripCtx.getImageData(0, 0, w, 5).data
          // The middle row of the strip, averaged over a 3x3 patch so compression noise cannot flip a cell.
          const patch: Pixels = (x) => {
            let sum = 0
            for (let dy = 1; dy <= 3; dy++) for (let dx = -1; dx <= 1; dx++) sum += luma(d, (dy * w + x + dx) * 4)
            return sum / 9
          }
          const cells = readCells(patch, w, 2)
          us = cells ? timeOf(cells) : null
        }
        if (us !== null && this.accept(us)) {
          misses = 0
          // When this frame is expected on screen, on the wall clock, less when it was stamped.
          const shownAt = performance.timeOrigin + (meta.expectedDisplayTime ?? now)
          this.delays.push(shownAt - us / 1000)
          if (this.delays.length > WINDOW_FRAMES) this.delays.shift()
          this.lastReadAt = performance.now()
        } else if (us === null && ++misses >= 8) {
          rowY = null // the picture moved (another source in the program): look again
          misses = 0
        }
      }
      this.video.requestVideoFrameCallback(onFrame)
    }
    this.video.requestVideoFrameCallback(onFrame)
  }
}

/** Connects to a WHEP stream of its own and measures the delay since each frame was stamped. */
export class LatencyMeter extends BitstripReader {
  private startTimer: ReturnType<typeof setTimeout> | undefined
  private close: (() => void) | undefined
  error: string | null = null

  constructor(
    private readonly url: string,
    video: HTMLVideoElement,
  ) {
    super(video)
    // Not at once: see WHEP_CONNECT_DELAY_MS.
    this.startTimer = setTimeout(() => void this.start(), WHEP_CONNECT_DELAY_MS)
  }

  override dispose() {
    super.dispose()
    clearTimeout(this.startTimer)
    this.close?.()
  }

  private async start() {
    try {
      const close = await connectWhep(this.url, (stream) => {
        if (!this.cancelled && this.video.srcObject !== stream) this.video.srcObject = stream
      })
      if (this.cancelled) return close()
      this.close = close
      await this.video.play().catch(() => {})
      this.begin()
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    }
  }
}
