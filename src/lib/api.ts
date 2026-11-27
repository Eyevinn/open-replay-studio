/** The Open Replay API. The studio holds no keys: the API reads the store and drives Strom for it. */
export const API_URL = ((import.meta.env.OPEN_REPLAY_API_URL as string | undefined) ?? 'http://localhost:3100').replace(/\/+$/, '')

/** An error reply from the API, with its HTTP status. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** GET or send JSON to the API, and turn an error reply into a thrown message. */
export async function api<T>(path: string, init?: { method?: string; json?: unknown }): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.json !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  })
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
  if (!res.ok) throw new ApiError(body.message ?? body.error ?? `${res.status} ${res.statusText}`, res.status)
  return body as T
}
