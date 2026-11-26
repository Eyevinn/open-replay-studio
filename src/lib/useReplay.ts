import { useSyncExternalStore } from 'react'
import type { ReplayController, ReplayState } from './controller'

export function useReplayState(controller: ReplayController): ReplayState {
  return useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.getState(),
  )
}
