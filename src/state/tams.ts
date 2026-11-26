import type { Stream } from '../model'
import { api } from '../lib/api'

/** Every stream of the store that has recordings. Throws, with the reason, when the store cannot be read. */
export const fetchStreams = (): Promise<Stream[]> => api<Stream[]>('/streams')
