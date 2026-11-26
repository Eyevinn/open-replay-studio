#!/usr/bin/env node
// A synthetic test chain, for when there are no real streams to measure on: a Strom flow generates a moving
// picture with the UTC time burned in, sends it over SRT to a test production in Open Live, and a second Strom
// flow plays it back from TAMS. The Studio's latency panel can point at its two program outputs.
//
//   source flow (Strom) -> SRT -> test production (Open Live) -> program output
//                                         |
//                                         +-> TAMS gateway -> replay flow (Strom) -> program output
//
// To measure real streams instead, set `latency_burn_in: true` in a production's values in Open Live: the
// burn-in is then added to its own inputs and the panel points at that production's outputs. This chain is
// optional and leaves nothing behind when deleted.
//
//   node scripts/synthetic-chain.mjs create   build the flows, source and production (once)
//   node scripts/synthetic-chain.mjs start    start them, in order, and set the replay to live
//   node scripts/synthetic-chain.mjs stop     stop them
//   node scripts/synthetic-chain.mjs status
//   node scripts/synthetic-chain.mjs live     send `live` to the replay again
//   node scripts/synthetic-chain.mjs delete   stop and remove everything create made
//
// Env: STROM_URL (http://localhost:8080), OPEN_LIVE_URL (http://localhost:3000),
//      OPEN_LIVE_ENV (path of Open Live's .env, read for OSC_ACCESS_TOKEN and TAMS_GATEWAY_URL, ../open-live/.env).
// The gateway's flow is left in place by `delete`: segments are only ever removed through the gateway.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const STROM = (process.env.STROM_URL ?? 'http://localhost:8080').replace(/\/+$/, '')
const OPEN_LIVE = (process.env.OPEN_LIVE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const OPEN_LIVE_ENV = process.env.OPEN_LIVE_ENV ?? fileURLToPath(new URL('../../open-live/.env', import.meta.url))
const SOURCE_FLOW = 'Latency test source'
const REPLAY_FLOW = 'Open Replay latency test'
const PRODUCTION = 'Latency test'
const SOURCE_NAME = 'Latency test source' // the source in Open Live (the Strom source flow has the same name)
const SRT_PORT = 5021
// Open Live listens, the source flow connects out to it: Open Live refuses loopback addresses for a source it dials.
const SOURCE_ADDRESS = `srt://:${SRT_PORT}?mode=listener`
const PRODUCTION_VALUES = {
  pgm_resolution: '1280x720',
  multiview_resolution: '1280x720',
  pgm_framerate: '25/1',
  multiview_framerate: '25/1',
  bitrate: 2000,
  multiview_bitrate: 2000,
  mix_latency: 100,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (m) => console.log(m)

async function json(url, init) {
  const res = await fetch(url, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${res.status} ${text.slice(0, 160)}`)
  return text ? JSON.parse(text) : null
}

const flows = async () => {
  const d = await json(`${STROM}/api/flows`)
  return d.flows ?? d
}
const flowNamed = async (name) => {
  const f = (await flows()).find((x) => x.name === name)
  if (!f) throw new Error(`No Strom flow named "${name}". Create the test chain first.`)
  return f
}
const production = async () => {
  const list = await json(`${OPEN_LIVE}/api/v1/productions`)
  const p = (Array.isArray(list) ? list : (list.productions ?? [])).find((x) => x.name === PRODUCTION)
  if (!p) throw new Error(`No Open Live production named "${PRODUCTION}".`)
  return { id: p.id ?? p._id, status: p.status }
}
const flowCmd = (id, cmd) => fetch(`${STROM}/api/flows/${id}/${cmd}`, { method: 'POST' })

async function bringUp() {
  const src = await flowNamed(SOURCE_FLOW)
  if (!src.running) {
    say(`Starting "${SOURCE_FLOW}"`)
    await flowCmd(src.id, 'start')
  }

  let prod = await production()
  if (prod.status !== 'active') {
    say(`Activating production "${PRODUCTION}"`)
    await json(`${OPEN_LIVE}/api/v1/productions/${prod.id}/activate`, { method: 'POST', headers: { 'content-type': 'application/json' } })
    for (let i = 0; i < 40 && (prod = await production()).status !== 'active'; i++) await sleep(1500)
    if (prod.status !== 'active') throw new Error(`Production "${PRODUCTION}" did not become active (status ${prod.status}).`)
  }
  say('Waiting 12 s for the first fresh segments to reach TAMS')
  await sleep(12000)

  // The player reads the flow's frame rate once, at start, so (re)start it now that the stream is flowing.
  const rep = await flowNamed(REPLAY_FLOW)
  if (rep.running) {
    await flowCmd(rep.id, 'stop')
    await sleep(1500)
  }
  const pat = parseEnv(readFileSync(OPEN_LIVE_ENV, 'utf8'))['OSC_ACCESS_TOKEN']
  if (pat) {
    await json(`${STROM}/api/osc/pat/${rep.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pat }) })
  } else {
    say(`No OSC_ACCESS_TOKEN in ${OPEN_LIVE_ENV}: the replay flow cannot read from the gateway.`)
  }
  say(`Starting "${REPLAY_FLOW}"`)
  await flowCmd(rep.id, 'start')
  await sleep(8000)

  return { behind: await goLive(rep.id, prod.id), prodId: prod.id }
}

// Strom's TAMS Output registers a flow once, at its first segment, with the caps it has seen by then. When
// that is too early the flow has no frame rate and the replay never gets a timeline. A fresh start of the
// production usually gets it right, so try twice.
async function start() {
  let r = await bringUp()
  if (r.behind === null) {
    say('The replay got no timeline (the TAMS flow was probably registered without a frame rate). Trying once more.')
    await stop()
    await sleep(3000)
    r = await bringUp()
  }
  const liveEndpoint = `pgm-${r.prodId.replace(/^prod-/, '').slice(0, 8)}`
  say(r.behind === null ? 'The replay still has no timeline. Stop and start again, or look at the TAMS flow in the gateway.' : `Replay is playing live, ${(r.behind / 1000).toFixed(1)} s behind the edge.`)
  say('')
  say('Studio .env:')
  say(`OPEN_REPLAY_LATENCY_LIVE_WHEP_URL=${STROM}/whep/${liveEndpoint}`)
  say(`OPEN_REPLAY_LATENCY_REPLAY_WHEP_URL=${STROM}/whep/openreplay-lat-pgm`)
}

// Waits until the replay group has a timeline, sends `live`, and returns how far behind the live edge it
// ends up, in ms (null if it never got a timeline).
async function goLive(flowId, group) {
  const ws = new WebSocket(`${STROM.replace(/^http/, 'ws')}/api/replay/${flowId}/${group}/ws`)
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
  if (!(state?.total_frames > 0)) {
    ws.close()
    return null
  }
  ws.send(JSON.stringify({ cmd: 'live', seq: 1 }))
  await sleep(2500)
  ws.close()
  return Math.round(((state.live_frame - state.frame) * state.frame_ns) / 1e6)
}

async function live() {
  const prod = await production()
  const behind = await goLive((await flowNamed(REPLAY_FLOW)).id, prod.id)
  say(behind === null ? 'The replay has no timeline yet.' : `Replay is playing live, ${(behind / 1000).toFixed(1)} s behind the edge.`)
}

async function stop() {
  const prod = await production()
  if (prod.status === 'active') {
    await json(`${OPEN_LIVE}/api/v1/productions/${prod.id}/deactivate`, { method: 'POST' })
    say(`Deactivated "${PRODUCTION}"`)
  }
  for (const name of [REPLAY_FLOW, SOURCE_FLOW]) {
    const f = await flowNamed(name)
    if (f.running) {
      await flowCmd(f.id, 'stop')
      say(`Stopped "${name}"`)
    }
  }
}

async function status() {
  const prod = await production()
  say(`production "${PRODUCTION}": ${prod.status}`)
  for (const name of [SOURCE_FLOW, REPLAY_FLOW]) say(`flow "${name}": ${(await flowNamed(name)).running ? 'running' : 'stopped'}`)
}


// ---------------------------------------------------------------------------------------------------------
// create and delete
// ---------------------------------------------------------------------------------------------------------

const ol = (path, method = 'GET', body) =>
  json(`${OPEN_LIVE}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const openLiveEnv = () => parseEnv(readFileSync(OPEN_LIVE_ENV, 'utf8'))
const findFlow = async (name) => (await flows()).find((x) => x.name === name)
const asList = (d) => (Array.isArray(d) ? d : (d.sources ?? d.productions ?? []))

async function gatewayAccess() {
  const env = openLiveEnv()
  const base = (process.env.TAMS_GATEWAY_URL ?? env['TAMS_GATEWAY_URL'] ?? '').replace(/\/+$/, '')
  const pat = env['OSC_ACCESS_TOKEN']
  if (!base || !pat) throw new Error(`Need TAMS_GATEWAY_URL and OSC_ACCESS_TOKEN in ${OPEN_LIVE_ENV}.`)
  const tok = await json('https://token.svc.prod.osaas.io/servicetoken', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pat-jwt': `Bearer ${pat}` },
    body: JSON.stringify({ serviceId: 'eyevinn-tams-gateway' }),
  })
  return { base, headers: { 'x-jwt': `Bearer ${tok.token}` } }
}

// A moving picture with the UTC time burned in, as SRT out. A software encoder: the default on a Mac writes
// no frame rate into the stream, and then the TAMS flow has none either and the replay cannot get a timeline.
const sourceFlowBody = () => ({
  id: crypto.randomUUID(),
  name: SOURCE_FLOW,
  properties: { description: `Moving test pattern with burned-in UTC time and code row, SRT caller to :${SRT_PORT}`, ephemeral: false },
  elements: [
    { id: 'vsrc', element_type: 'videotestsrc', properties: { pattern: 'ball', 'is-live': true }, position: [50, 80] },
    { id: 'asrc', element_type: 'audiotestsrc', properties: { wave: 'silence', 'is-live': true }, position: [50, 260] },
  ],
  blocks: [
    { id: 'fmt', block_definition_id: 'builtin.videoformat', name: 'Format 1280x720', properties: { resolution: '1280x720' }, position: { x: 250, y: 80 } },
    { id: 'refts', block_definition_id: 'builtin.reference_timestamp', name: 'Burn-in UTC', properties: { timescale: 'utc', burn_in: true }, position: { x: 480, y: 80 } },
    { id: 'venc', block_definition_id: 'builtin.videoenc', name: 'Encode H.264', properties: { codec: 'h264', bitrate: 4000, keyframe_interval: 25, encoder_preference: 'software' }, position: { x: 720, y: 80 } },
    { id: 'aenc', block_definition_id: 'builtin.audioenc', name: 'Encode AAC', properties: { codec: 'aac' }, position: { x: 720, y: 260 } },
    { id: 'srtout', block_definition_id: 'builtin.mpegtssrt_output', name: `SRT out to :${SRT_PORT}`, properties: { srt_uri: `srt://127.0.0.1:${SRT_PORT}?mode=caller`, num_audio_tracks: 1 }, position: { x: 980, y: 160 } },
  ],
  links: [
    { from: 'vsrc:src', to: 'fmt:video_in' },
    { from: 'fmt:video_out', to: 'refts:in' },
    { from: 'refts:out', to: 'venc:video_in' },
    { from: 'venc:encoded_out', to: 'srtout:video_in' },
    { from: 'asrc:src', to: 'aenc:audio_in' },
    { from: 'aenc:encoded_out', to: 'srtout:audio_in_0' },
  ],
})

// One media player in replay mode on the production's TAMS flow, a mixer and two WHEP outputs.
function replayFlowBody(prodId, tamsFlowId, gateway) {
  return {
    id: crypto.randomUUID(),
    name: REPLAY_FLOW,
    properties: { description: `Open Replay latency test of ${prodId}`, ephemeral: false },
    elements: [],
    blocks: [
      {
        id: 'cam1', block_definition_id: 'builtin.media_player', name: SOURCE_NAME,
        properties: {
          replay_group: prodId,
          replay_source: `tams+https://${new URL(gateway).host}/flows/${tamsFlowId}`,
          replay_auth_mode: 'osc',
          num_audio_tracks: 0,
        },
        position: { x: 100, y: 80 },
      },
      { id: 'vm', block_definition_id: 'builtin.vision_mixer', name: 'Replay mixer', properties: { num_inputs: 1, multiview_framerate: '25/1', pgm_framerate: '25/1', input_0_label: SOURCE_NAME }, position: { x: 400, y: 160 } },
      { id: 'enc_mv', block_definition_id: 'builtin.videoenc', name: 'Enc multiview', properties: {}, position: { x: 700, y: 100 } },
      { id: 'enc_pgm', block_definition_id: 'builtin.videoenc', name: 'Enc program', properties: {}, position: { x: 700, y: 260 } },
      { id: 'whep_mv', block_definition_id: 'builtin.whep_output', name: 'Multiview WHEP', properties: { num_audio_tracks: 0, endpoint_id: 'openreplay-lat-mv' }, position: { x: 950, y: 100 } },
      { id: 'whep_pgm', block_definition_id: 'builtin.whep_output', name: 'Program WHEP', properties: { num_audio_tracks: 0, endpoint_id: 'openreplay-lat-pgm' }, position: { x: 950, y: 260 } },
    ],
    links: [
      { from: 'cam1:video_out', to: 'vm:video_in_0' },
      { from: 'vm:multiview_out', to: 'enc_mv:video_in' },
      { from: 'vm:pgm_out', to: 'enc_pgm:video_in' },
      { from: 'enc_mv:encoded_out', to: 'whep_mv:video_in' },
      { from: 'enc_pgm:encoded_out', to: 'whep_pgm:video_in' },
    ],
  }
}

async function create() {
  // Open Live: the source Open Live listens on, and a production that has it on its first input.
  let src = asList(await ol('/sources')).find((x) => x.name === SOURCE_NAME)
  src ??= await ol('/sources', 'POST', { name: SOURCE_NAME, address: SOURCE_ADDRESS, streamType: 'srt', latency: 125 })
  let prod = asList(await ol('/productions')).find((x) => x.name === PRODUCTION)
  if (!prod) {
    prod = await ol('/productions', 'POST', { name: PRODUCTION })
    await ol(`/productions/${prod.id ?? prod._id}`, 'PATCH', { values: PRODUCTION_VALUES })
    await ol(`/productions/${prod.id ?? prod._id}/sources`, 'POST', { sourceId: src.id ?? src._id, mixerInput: 'video_in_0' })
  }
  const prodId = prod.id ?? prod._id
  say(`Open Live: source "${SOURCE_NAME}", production "${PRODUCTION}"`)

  // Strom: the source flow.
  if (!(await findFlow(SOURCE_FLOW))) {
    await json(`${STROM}/api/flows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sourceFlowBody()) })
  }
  say(`Strom: flow "${SOURCE_FLOW}"`)

  // The replay flow needs the production's TAMS flow, which the gateway only has once media has been written:
  // run the chain until it is there.
  if (!(await findFlow(REPLAY_FLOW))) {
    say('Running the production once, so the gateway has its flow (about a minute)')
    await flowCmd((await flowNamed(SOURCE_FLOW)).id, 'start')
    await json(`${OPEN_LIVE}/api/v1/productions/${prodId}/activate`, { method: 'POST', headers: { 'content-type': 'application/json' } })
    const { base, headers } = await gatewayAccess()
    let tams
    for (let i = 0; i < 40 && !tams; i++) {
      await sleep(2000)
      const all = await json(`${base}/flows`, { headers })
      tams = all.find((f) => f.tags?.production === prodId)
    }
    if (!tams) throw new Error('The gateway never got a flow for the production. Is Open Live set up with TAMS_GATEWAY_URL?')
    await json(`${STROM}/api/flows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(replayFlowBody(prodId, tams.id, base)) })
    await stop()
  }
  say(`Strom: flow "${REPLAY_FLOW}"`)
  say('Created. Start it with: node scripts/synthetic-chain.mjs start')
}

async function remove() {
  await stop().catch(() => {})
  for (const name of [REPLAY_FLOW, SOURCE_FLOW]) {
    const f = await findFlow(name)
    if (f) {
      await fetch(`${STROM}/api/flows/${f.id}`, { method: 'DELETE' })
      say(`Deleted flow "${name}"`)
    }
  }
  const prod = asList(await ol('/productions')).find((x) => x.name === PRODUCTION)
  if (prod) {
    await fetch(`${OPEN_LIVE}/api/v1/productions/${prod.id ?? prod._id}`, { method: 'DELETE' })
    say(`Deleted production "${PRODUCTION}"`)
  }
  const src = asList(await ol('/sources')).find((x) => x.name === SOURCE_NAME)
  if (src) {
    await fetch(`${OPEN_LIVE}/api/v1/sources/${src.id ?? src._id}`, { method: 'DELETE' })
    say(`Deleted source "${SOURCE_NAME}"`)
  }
}

const cmd = process.argv[2]
const run = { create, start, stop, status, live, delete: remove }[cmd]
if (!run) {
  console.error('usage: node scripts/synthetic-chain.mjs create | start | stop | status | live | delete')
  process.exit(2)
}
run().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
