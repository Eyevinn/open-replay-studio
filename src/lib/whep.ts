// How long a component waits before it opens a viewer. React (StrictMode, in dev) mounts, unmounts and mounts
// again at once, which would open a viewer and drop it a moment later. Strom's WHEP server (gst-plugin-webrtc
// 0.15.4) can panic on a session torn down while its SDP answer is being set up, and the panic aborts Strom, so
// a viewer that is dropped before it was ever needed is not opened at all.
export const WHEP_CONNECT_DELAY_MS = 400

// Minimal WHEP client: POST an SDP offer, apply the SDP answer. Not yet tested against Strom.
// The caller decides what to do with the stream, so a connection that has been cancelled (React
// StrictMode mounts effects twice in dev) can never put its dying stream on the video element.
export async function connectWhep(url: string, onStream: (stream: MediaStream) => void): Promise<() => void> {
  // A Strom behind NAT, such as the deployed one, is reached only through the TURN server it lists for browsers.
  const base = url.split('/whep/')[0] ?? ''
  const pc = new RTCPeerConnection(await iceConfig(base))
  pc.addTransceiver('video', { direction: 'recvonly' })
  pc.addTransceiver('audio', { direction: 'recvonly' })
  pc.ontrack = (e) => {
    if (e.streams[0]) onStream(e.streams[0])
  }
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve()
    const done = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', done)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', done)
    setTimeout(resolve, 2000)
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription?.sdp ?? '',
  })
  if (!res.ok) {
    pc.close()
    throw new Error(`WHEP ${res.status}`)
  }
  // Strom names the session from its own root, which is not where this page reaches it when Strom is proxied.
  const header = res.headers.get('Location')
  const location = header && header.startsWith('/') && !header.startsWith(new URL(base, window.location.href).pathname + '/') ? `${base}${header}` : header
  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() })
  return () => {
    pc.close()
    if (location) void fetch(new URL(location, url), { method: 'DELETE' }).catch(() => {})
  }
}

/** The ICE servers Strom lists for browsers. A Strom that lists none, or cannot be asked, is used with the defaults. */
async function iceConfig(base: string): Promise<RTCConfiguration> {
  try {
    const res = await fetch(`${base}/api/ice-servers`)
    if (!res.ok) return {}
    const body = (await res.json()) as { ice_servers?: RTCIceServer[]; ice_transport_policy?: RTCIceTransportPolicy }
    return { iceServers: body.ice_servers ?? [], iceTransportPolicy: body.ice_transport_policy ?? 'all' }
  } catch {
    return {}
  }
}
