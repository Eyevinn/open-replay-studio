# open-replay-studio

Browser production controller for [Open Replay](https://github.com/Eyevinn/open-replay): multiview, cue, mark, clip bin and playlists for live replay and slow-motion.

## Status

Early. The studio has a shell and the screens around the replay screen, **reading the real TAMS store** (streams, their tags and extents) but not yet sending anything to Strom: the replay screen is still the earlier operator view. Groups and outputs are the studio's own data, kept in the browser. Marks, clips and playlists are kept by the Open Replay API. The object model follows ADR-0001 in the dev team repo (`Eyevinn/agent-team-open-replay-dev`, `docs/decisions/`): the core concept is the **group**, a named, ordered set of recorded streams that share one timeline. Open Replay works without Open Live.

| Screen | Route | What it does |
|---|---|---|
| Groups (home) | `#/groups` | The groups you can open, with live state and new streams that match a rule |
| Group | `#/groups/<id>` | Edit a group: tag rule, and each stream's key, label and offset |
| Streams | `#/streams` | Browse the store, pick streams, make a group or open them once |
| Library | `#/library` | Clips and marks, tags, stars, add to a playlist |
| Playlists | `#/playlists` | Ordered clips, each with its own speed |
| Outputs | `#/outputs` | Named SRT destinations to choose from when starting a replay (two Open Live replay slots to begin with) |
| Replay | `#/replay/<group id>` | Choose an output and start the group's replay. Then: a preview window, a program monitor with a Take button, and a strip of every source on its own video. Click a source (or press 1-9) to preview it, even the one on air. The control bar at the bottom of the page holds the transport and Take (or Enter). Each source shows how far it is behind the leading one, read from the bit strip burned into its picture |
| Settings | `#/settings` | Store status, mark tags, optional Open Live link, clear studio data |

The earlier operator screen shows the multiview and lets the operator jump back 10 seconds, scrub within the last 10 seconds, and go back to live. Cue, marks and clips on that screen are not built yet.

- The data layer is `src/state/`: the user's groups and outputs are kept in the browser (`localStorage`); marks, clips and playlists are kept by the API (`src/lib/libraryApi.ts`) and shown at once, sent in order, and put back to what the API holds if a change is refused; what an older version kept in the browser is moved to the API once, with a copy left in `open-replay-studio.v2.library-backup`. `src/state/tams.ts` reads the TAMS store every 5 s. The studio holds no keys: it calls the Open Replay API (`repos/open-replay`, address in `OPEN_REPLAY_API_URL`, `http://localhost:3100` by default), which reads the store, starts and stops each group's replay on Strom, and proxies the operator screen's WebSocket and video. The OSC access token and the Strom key are set on that API. Starting a replay (the Replay screen of a group) sends its program to the chosen output, for example an Open Live replay slot (`srt://127.0.0.1:5031?mode=caller` for a listener on 5031). Streams tagged `replay_group=<name>` (Open Live writes it from the production name) are offered on the Groups screen as ready-made groups.
- There is no router library: `src/app/router.ts` is a small hash router.
- The video comes from a WHEP multiview stream when `OPEN_REPLAY_MULTIVIEW_WHEP_URL` is set (untested against Strom so far). Without it the Studio draws a demo source whose clocks run behind real time by the current offset.
- Playhead commands go through a controller. `MockController` stands in until the Open Replay backend API exists (`src/lib/controller.ts`).

## Develop

```bash
pnpm install
cp .env.example .env   # optional
pnpm dev               # http://localhost:5174
pnpm typecheck
pnpm build
pnpm test              # Vitest, jsdom and Testing Library
```

The gate for a change is `pnpm typecheck && pnpm build && pnpm test`, which CI runs on every pull request
(`.github/workflows/ci.yml`). Tests sit next to the code. Layout and pixel criteria are checked by a person, not by
the pull request (`CLAUDE.md`).

## Latency

The Studio can show how long a frame takes from the input of an Open Live production to the screen, on the Open
Live path and on the Open Replay path (through TAMS). Open Live burns the time into each input's picture, as UTC
text and a machine-readable code row, and the Studio decodes it on each program output (`src/lib/burnin.ts`).

1. In Open Live, set `latency_burn_in: true` in the production's values (the Demo Production has it) and activate
   the production. Each input then gets a Reference Timestamp block with burn-in, ahead of the mixers, the ISO
   recorder and the TAMS tap, so the program output and the TAMS segments both carry the time. It draws on the
   picture, so it is a test mode and off by default.
2. Set `OPEN_REPLAY_LATENCY_LIVE_WHEP_URL` to that production's program output and
   `OPEN_REPLAY_LATENCY_REPLAY_WHEP_URL` to the Open Replay flow's (see `.env.example`).

The delay counts from the input of the production: the camera, the network and the SRT buffer before it are not in
it. The Open Replay figure includes the replay offset, so it grows when you jump back.

### Replay API v3

Strom is getting a new replay API ("Förslag: städat replay-API", version 3: exact times as nanosecond strings, typed
state, events with reasons). The Studio speaks it already, written from that document, and picks the version at run
time: `GET /api/replay` on Strom answers v3, a 404 means the first API, which keeps working. The controls for v3 are
live, play, pause, speed (slow motion from live starts 4, 8 or 15 s back), jump, frame step and scrub; mark and mark
8 s back; in, out, cue, play clip, release and save clip (with exact in and out); follow live, the live margin
(computed or set) and the readiness of the angles; and a list of what Strom reports happened and why. Keys: space,
L, left and right arrows (shift for five frames), I, O, C and M.

All reading of Strom's JSON is in `src/lib/replayV3/normalize.ts`, written from the definition and not from Strom's own
`REPLAY_API.md` and `openapi.json`, which are not published yet: check the field names there first when v3 deploys.
There is no Strom with v3 yet, so `scripts/mock-replay-v3.mjs` stands in for it (`node scripts/mock-replay-v3.mjs`,
port 4010). Open `#/dev/replay-v3`, press Connect, and the controls run against the mock without the videos.

### Live margin

`live` plays a margin behind the newest segment Strom knows about, so a late segment doesn't run the cursor dry.
Measured on the Demo Production with 1 s segments (four runs per setting, delay median of the Open Replay program,
smooth = no gap over 125 ms): 1500 ms gave 4.0 s; 1000 ms gave 3.5 s, smooth in every run; 750 ms gave 2.9 s,
smooth; 500 ms gave 3.0 s with a 625 ms gap in one run; 250 ms gave 2.4 s with a 167 ms gap. Set
`REPLAY_LIVE_MARGIN_MS` on the Open Replay API; the studio gets the value from the playback status and uses it for its live commands and for the offset readout. A shorter segment
length should allow a shorter margin: with 500 ms segments (Strom branch `exp/subsecond-segments`, Open Live
`TAMS_SEGMENT_MS=500`) 800 ms was smooth in four runs and gave 2.4 to 2.5 s, 1000 ms gave about 2.65 s, and 600 ms
stuttered (four skips, a 1.25 s gap).

### Synthetic chain (optional)

When there are no real streams to measure on, `scripts/synthetic-chain.mjs` builds a stand-in: a Strom flow that
generates a picture with the time burned in, an Open Live production that takes it, and a Strom flow that plays it
back from TAMS. It leaves nothing behind when deleted.

```bash
pnpm chain:create    # once: the source, the production and the two flows
pnpm chain:start     # start them in order and set the replay to live
pnpm chain:stop
pnpm chain:delete    # remove everything create made (the gateway keeps its flow)
```

Strom's TAMS Output registers a flow once, at its first segment. If that is before the stream's caps are known, the
flow has no frame rate and the replay never gets a timeline; `chain:start` retries once.

## License

Apache-2.0

## Clips and playlists on air

The Playlists screen has a **Play** panel: pick the group's replay, choose what happens at the end (hold the last frame, play again, go live), and press Play. The backend's playlist runner plays it on clip player A and keeps Strom's queue filled; the panel shows the item playing and how many are queued. The Library has **Cue on B** and **Play on B** on each clip, with a camera choice, so a clip can be checked from another angle at the same moment. Replay flows now have the two clip players (ADR-0002, phase 3), and a clip cued on B or a playlist started on A is shown in preview, so Take sends it to air. Putting a clip on a clip player needs Strom's planned `cue {source}` and queue, which are not in the deployed Strom yet: today Strom refuses the cue and the panel shows its answer. The controls were exercised against a mock of that queue in the backend repo.

### Playlists beside the replay

The Replay screen has a **Playlists** button next to the status chips. It opens a side panel for building and playing playlists while the replay runs: pick or create a playlist, add clips of this group, set each item's speed, reorder or remove items, choose what happens at the end, and press Play. The controls have **Save and add**, which saves the clip cut between In and Out and appends it to the playlist chosen in the panel in one step. While a playlist plays, its current item is highlighted. The camera of a saved clip is read from the replay's own angles, so it works for a replay whose group this browser does not know. The panel is also on the dev page (`#/dev/replay-v3`) against the mock.
