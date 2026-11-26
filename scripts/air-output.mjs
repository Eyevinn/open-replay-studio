#!/usr/bin/env node
// Sends the replay program back into Open Live as a source, over SRT, so it can go on air.
//
//   replay flow (Strom) -> vision mixer program -> Enc air (high bitrate) -> SRT caller
//        -> Open Live source "Open Replay PGM" (SRT listener) -> input of the production
//
// The WHEP program output (about 4 Mbit/s, tuned for a browser) stays as it is, for monitoring. This adds a
// separate encode meant for contribution. Idempotent: run it again and it finds what it already made.
//
//   node scripts/air-output.mjs            add the source, put it on the production, add the output to the flow
//   node scripts/air-output.mjs remove     take all three away again
//
// The source is marked `recordToTams: false`, so Open Live does not write the replay back into TAMS as an
// angle of its own production. The production must be inactive while a source is added to it: this script
// deactivates it if needed and leaves it inactive (run scripts/demo-up.mjs afterwards).
//
// Env: STROM_URL (http://localhost:8080), OPEN_LIVE_URL (http://localhost:3000),
//      OPEN_REPLAY_PRODUCTION (production name, "Demo Production"), OPEN_REPLAY_REPLAY_FLOW ("Open Replay multiview"),
//      AIR_SRT_PORT (5030), AIR_BITRATE_KBPS (10000), AIR_PRESET (medium), AIR_RESOLUTION (1280x720),
//      AIR_FRAMERATE (25/1), AIR_LATENCY_MS (200).

const STROM = (process.env.STROM_URL ?? 'http://localhost:8080').replace(/\/+$/, '')
const OPEN_LIVE = (process.env.OPEN_LIVE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const PRODUCTION = process.env.OPEN_REPLAY_PRODUCTION ?? 'Demo Production'
const REPLAY_FLOW = process.env.OPEN_REPLAY_REPLAY_FLOW ?? 'Open Replay multiview'
const PORT = Number(process.env.AIR_SRT_PORT ?? 5030)
const BITRATE = Number(process.env.AIR_BITRATE_KBPS ?? 10000)
const PRESET = process.env.AIR_PRESET ?? 'medium'
const RESOLUTION = process.env.AIR_RESOLUTION ?? '1280x720'
const FRAMERATE = process.env.AIR_FRAMERATE ?? '25/1'
const LATENCY = Number(process.env.AIR_LATENCY_MS ?? 200)
const SOURCE_NAME = 'Open Replay PGM'
// Open Live listens, the replay flow calls out to it: Open Live refuses loopback addresses for a source it dials.
const SOURCE_ADDRESS = `srt://:${PORT}?mode=listener`
const BLOCKS = ['enc_air', 'srt_air']
const ELEMENTS = ['q_air']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (m) => console.log(m)
const asList = (d) => (Array.isArray(d) ? d : (d?.items ?? d?.sources ?? d?.productions ?? d?.rows ?? []))
const idOf = (d) => d.id ?? d._id

async function json(url, init) {
  const res = await fetch(url, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}
const ol = (path, method = 'GET', body) =>
  json(`${OPEN_LIVE}/api/v1${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })

async function production() {
  const p = asList(await ol('/productions')).find((x) => x.name === PRODUCTION)
  if (!p) throw new Error(`No production named "${PRODUCTION}" in Open Live`)
  return p
}
async function replayFlow() {
  const d = await json(`${STROM}/api/flows`)
  const f = (d.flows ?? d).find((x) => x.name === REPLAY_FLOW)
  if (!f) throw new Error(`No Strom flow named "${REPLAY_FLOW}"`)
  return json(`${STROM}/api/flows/${f.id}`).then((x) => x.flow ?? x)
}
const putFlow = async (flow) => {
  await fetch(`${STROM}/api/flows/${flow.id}/stop`, { method: 'POST' }).catch(() => {}) // a running flow cannot be replaced
  return json(`${STROM}/api/flows/${flow.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(flow) })
}

async function deactivate(prod) {
  if (prod.status !== 'active') return
  say('Deactivating the production (a source cannot be added to an active one)')
  await ol(`/productions/${idOf(prod)}/deactivate`, 'POST')
  for (let i = 0; i < 20; i++) {
    if ((await production()).status !== 'active') return
    await sleep(1000)
  }
}

async function add() {
  // Open Live: the source, then its place on the production.
  let src = asList(await ol('/sources')).find((x) => x.name === SOURCE_NAME)
  src ??= await ol('/sources', 'POST', { name: SOURCE_NAME, address: SOURCE_ADDRESS, streamType: 'srt', latency: LATENCY, recordToTams: false })
  say(`Open Live source "${SOURCE_NAME}" (${SOURCE_ADDRESS})`)

  let prod = await production()
  if (!(prod.sources ?? []).some((a) => a.sourceId === idOf(src))) {
    await deactivate(prod)
    prod = await production()
    const used = new Set((prod.sources ?? []).map((a) => a.mixerInput))
    let n = 0
    while (used.has(`video_in_${n}`)) n++
    await ol(`/productions/${idOf(prod)}/sources`, 'POST', { sourceId: idOf(src), mixerInput: `video_in_${n}` })
    say(`Put it on "${PRODUCTION}" as video_in_${n}`)
  } else {
    say(`Already on "${PRODUCTION}"`)
  }

  // Strom: the encode and the SRT output, from the replay mixer's program.
  const flow = await replayFlow()
  const vm = flow.blocks.find((b) => b.block_definition_id === 'builtin.vision_mixer')
  if (!vm) throw new Error('The replay flow has no vision mixer')
  vm.properties = { ...vm.properties, pgm_resolution: RESOLUTION, multiview_resolution: RESOLUTION, pgm_framerate: FRAMERATE, multiview_framerate: FRAMERATE }
  const encProps = { bitrate: BITRATE, quality_preset: PRESET, rate_control: 'cbr', keyframe_interval: Number(FRAMERATE.split('/')[0]) * 2 }
  const blocks = flow.blocks.filter((b) => !BLOCKS.includes(b.id))
  blocks.push(
    { id: 'enc_air', block_definition_id: 'builtin.videoenc', name: 'Enc air', properties: { ...encProps, encoder_preference: 'software' }, position: { x: 700, y: 420 } },
    { id: 'srt_air', block_definition_id: 'builtin.mpegtssrt_output', name: 'SRT to Open Live',
      properties: { srt_uri: `srt://127.0.0.1:${PORT}?mode=caller`, latency: LATENCY, num_video_tracks: 1, num_audio_tracks: 0 }, position: { x: 950, y: 420 } },
  )
  const ours = (l) => [...BLOCKS, ...ELEMENTS].some((b) => String(l.from).startsWith(`${b}:`) || String(l.to).startsWith(`${b}:`))
  const links = flow.links.filter((l) => !ours(l))
  // A leaky queue in front of the air encoder: if the SRT peer is away or slow, frames are dropped here. Without it the
  // output backs up through the mixer and stalls the whole replay flow, players included.
  const elements = (flow.elements ?? []).filter((e) => !ELEMENTS.includes(e.id))
  elements.push({ id: 'q_air', element_type: 'queue', properties: { leaky: 'downstream', 'max-size-buffers': 0, 'max-size-bytes': 0, 'max-size-time': 1_000_000_000 }, position: [560, 420] })
  links.push({ from: 'vm:pgm_out', to: 'q_air:sink' }, { from: 'q_air:src', to: 'enc_air:video_in' }, { from: 'enc_air:encoded_out', to: 'srt_air:video_in' })
  await putFlow({ ...flow, blocks, links, elements })
  say(`Strom flow "${REPLAY_FLOW}": program ${RESOLUTION} ${FRAMERATE} -> Enc air ${BITRATE} kbit/s ${PRESET} -> SRT :${PORT}`)
  say('Restart the replay flow and activate the production to use it: node scripts/demo-up.mjs')
}

async function remove() {
  const prod = await production()
  const src = asList(await ol('/sources')).find((x) => x.name === SOURCE_NAME)
  if (src) {
    await deactivate(prod)
    await fetch(`${OPEN_LIVE}/api/v1/productions/${idOf(prod)}/sources/${idOf(src)}`, { method: 'DELETE' }).catch(() => {})
    await fetch(`${OPEN_LIVE}/api/v1/sources/${idOf(src)}`, { method: 'DELETE' })
    say(`Deleted Open Live source "${SOURCE_NAME}"`)
  }
  const flow = await replayFlow()
  await putFlow({
    ...flow,
    blocks: flow.blocks.filter((b) => !BLOCKS.includes(b.id)),
    elements: (flow.elements ?? []).filter((e) => !ELEMENTS.includes(e.id)),
    links: flow.links.filter((l) => ![...BLOCKS, ...ELEMENTS].some((b) => String(l.from).startsWith(`${b}:`) || String(l.to).startsWith(`${b}:`))),
  })
  say(`Removed the air output from "${REPLAY_FLOW}"`)
}

await (process.argv[2] === 'remove' ? remove() : add())
