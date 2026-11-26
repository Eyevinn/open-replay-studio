import { useEffect, useState, type RefObject } from 'react'
import { BitstripReader } from './burnin'

/**
 * The typical delay, in ms, from where the burned-in time of this video's frames was stamped to this screen, or null
 * while no frame with a readable bit strip is on screen. The number itself says little; the difference between two
 * sources of one timeline is how far apart they are.
 */
export function useBitstrip(ref: RefObject<HTMLVideoElement | null>): number | null {
  const [delay, setDelay] = useState<number | null>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const reader = new BitstripReader(video)
    reader.begin()
    const id = setInterval(() => setDelay(reader.stats()?.medianMs ?? null), 500)
    return () => {
      clearInterval(id)
      reader.dispose()
    }
  }, [ref])
  return delay
}
