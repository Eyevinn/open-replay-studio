#!/usr/bin/env node
// Brings the Demo Production and the Open Replay multiview up in an order that works, after a Strom restart
// or after the machine has slept:
//
//   1. stop the Open Replay flow (Strom starts it by itself when it comes up)
//   2. push the OSC token to it, then (re)activate the production in Open Live, which re-anchors its clock
//   3. wait for fresh segments, then start the Open Replay flow and set it to live
//
// Why in this order: in the runs where the replay was left running while the production restarted, its players
// stalled and did not recover, and a flow restart left stale players in the group. Starting the replay after the
// production had written for a while worked. The cause of the stalls is not established.
//
//   node scripts/demo-up.mjs [margin_ms]      default margin 1500 (800 with 500 ms segments)
//
// Env: STROM_URL (http://localhost:8080), OPEN_LIVE_URL (http://localhost:3000), OPEN_LIVE_ENV (../open-live/.env),
//      PRODUCTION (Demo Production), REPLAY_FLOW (Open Replay multiview).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const STROM = (process.env.STROM_URL ?? 'http://localhost:8080').replace(/\/+$/, '')
const OPEN_LIVE = (process.env.OPEN_LIVE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const OPEN_LIVE_ENV = process.env.OPEN_LIVE_ENV ?? fileURLToPath(new URL('../../open-live/.env', import.meta.url))
const PRODUCTION = process.env.PRODUCTION ?? 'Demo Production'
const REPLAY_FLOW = process.env.REPLAY_FLOW ?? 'Open Replay multiview'
const margin = Number(process.argv[2] ?? 1500)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (m) => console.log(m)
const json = async (url, init) => {
  const res = await fetch(url, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${res.status} ${text.slice(0, 160)}`)
  return text ? JSON.parse(text) : null
}
const flows = async () => {
  const d = await json(`${STROM}/api/flows`)
  return d.flows ?? d
}
const post = (path) => fetch(`${STROM}${path}`, { method: 'POST' })

const replay = (await flows()).find((f) => f.name === REPLAY_FLOW)
if (!replay) throw new Error(`No Strom flow named "${REPLAY_FLOW}".`)
const list = await json(`${OPEN_LIVE}/api/v1/productions`)
const prod = (Array.isArray(list) ? list : list.productions).find((p) => p.name === PRODUCTION)
if (!prod) throw new Error(`No Open Live production named "${PRODUCTION}".`)
const prodId = prod.id ?? prod._id

say(`1. stopping "${REPLAY_FLOW}"`)
await post(`/api/flows/${replay.id}/stop`)

say('2. token for the replay flow, then (re)activating the production')
const pat = parseEnv(readFileSync(OPEN_LIVE_ENV, 'utf8'))['OSC_ACCESS_TOKEN']
if (!pat) throw new Error(`No OSC_ACCESS_TOKEN in ${OPEN_LIVE_ENV}.`)
await json(`${STROM}/api/osc/pat/${replay.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pat }) })
if (prod.status !== 'inactive' && prod.status !== 'ended') await fetch(`${OPEN_LIVE}/api/v1/productions/${prodId}/deactivate`, { method: 'POST' })
await json(`${OPEN_LIVE}/api/v1/productions/${prodId}/activate`, { method: 'POST', headers: { 'content-type': 'application/json' } })
for (let i = 0; i < 40; i++) {
  const p = await json(`${OPEN_LIVE}/api/v1/productions/${prodId}`)
  if (p.status === 'active') break
  await sleep(1500)
}

say('3. waiting 25 s for the production to write its first segments')
await sleep(25000)
say(`   starting "${REPLAY_FLOW}"`)
await post(`/api/flows/${replay.id}/start`)

const ws = new WebSocket(`${STROM.replace(/^http/, 'ws')}/api/replay/${replay.id}/${prodId}/ws`)
let state
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.type === 'state') state = d
}
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = () => reject(new Error('replay WebSocket failed'))
})
for (let i = 0; i < 40 && !(state?.total_frames > 0); i++) await sleep(1000)
await sleep(4000)
if (!process.env.NO_LIVE) ws.send(JSON.stringify({ cmd: 'live', margin_ms: margin, seq: 1 }))
await sleep(4000)
const behindClock = Date.parse(state.now_utc) - Date.parse(state.cursor?.utc)
ws.close()
say(`Replay is playing live, ${(behindClock / 1000).toFixed(1)} s behind the clock (margin ${margin} ms). Open the Studio now.`)
