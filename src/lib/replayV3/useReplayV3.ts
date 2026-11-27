import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { detectReplayApi, ReplayV3Client, type ReplayClientOptions } from './client'
import type { ReplayEvent, ReplayView } from './types'

/** One client for the life of the component, closed when it goes. */
export function useReplayClient(opts: ReplayClientOptions): ReplayV3Client {
  const client = useMemo(() => new ReplayV3Client(opts), [opts.baseUrl, opts.flowId, opts.group, opts.stateMs]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    client.start()
    return () => client.dispose()
  }, [client])
  return client
}

export const useReplayView = (client: ReplayV3Client): ReplayView => useSyncExternalStore(client.subscribe, client.getView)
export const useReplayEvents = (client: ReplayV3Client): ReplayEvent[] => useSyncExternalStore(client.subscribe, client.getEvents)

/** Which replay API this Strom has: `undefined` while asking, then `{version: 1}` for one that has none, or v3's `{version: 2, features}`. */
export function useReplayApi(baseUrl: string): { version: number; features: string[] } | undefined {
  const [api, setApi] = useState<{ version: number; features: string[] } | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setApi(undefined)
    void detectReplayApi(baseUrl).then((a) => !cancelled && setApi(a ?? { version: 1, features: [] }))
    return () => {
      cancelled = true
    }
  }, [baseUrl])
  return api
}
