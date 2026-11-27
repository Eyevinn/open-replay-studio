# Open Replay Studio

The browser UI for Open Replay: a replay page for a running group (live, scrub, jog, speed, marks, clips,
playlists), plus the screens around it. A separate repo from the backend (`Eyevinn/open-replay`), as Open Live
Studio is for Open Live. Public repo.

## Stack

React 19, TypeScript (strict) and Vite 6. `pnpm` as the package manager (`packageManager` in `package.json`).
No router library: `src/app/router.ts` is a small hash router. The Studio holds no keys: it calls the Open
Replay API (`OPEN_REPLAY_API_URL`, `http://localhost:3100` by default), which talks to Strom and the TAMS store.

## The gate

A change is done when this passes, locally and in CI on the pull request:

```bash
pnpm typecheck && pnpm build && pnpm test
```

`pnpm test` runs Vitest in jsdom with Testing Library (`@testing-library/react`). Tests sit next to the code
(`*.test.ts`, `*.test.tsx`). The decision behind this is ADR-0003 in the dev team repo
(`Eyevinn/agent-team-open-replay-dev`, `docs/decisions/`).

- Test behaviour: what the user sees after an action, the commands the UI sends, key handling, how Strom's JSON is
  read. Use a fake replay client or mock `src/lib/replayApi.ts`; a test never needs a live Strom or backend.
  `scripts/mock-replay-v3.mjs` is a mock Strom replay API for trying the page by hand (`#/dev/replay-v3`).
- Layout and pixel criteria (spacing, fonts, colours, "matches the screenshots within a few pixels") are **not**
  checked by a pull request. State them in the closing comment under "What a human does next".

## Where things are

- `src/lib/replayV3/`: the client for Strom's replay API (typed state, exact `t` times in nanoseconds, events).
  `normalize.ts` is the only place that reads Strom's JSON.
- `src/lib/replayApi.ts` and `src/lib/libraryApi.ts`: the Open Replay API (replay status, preview, take,
  playlists and clips on the clip players; marks, clips and playlists).
- `src/state/store.ts`: the data layer. Marks, clips and playlists live on the API and are shown at once, sent in
  order and put back if refused; groups and outputs stay in the browser.
- `src/App.tsx`, `src/components/`, `src/screens/`: the replay page and the other screens.
- `README.md` has the details and how to run the whole stack.

## Rules

- This repo is public: no secrets, tokens, internal hostnames, SRT URIs with passphrases or customer names in
  code, commits, issues or pull requests. Keys live in the backend's `.env`, never in the Studio.
- Minimise dependencies. Add a library only when it does real work, and say why in the pull request.
- Times from Strom are nanosecond strings on the group axis: read them with `BigInt`, never as a JSON number.
- Never push to `main` without a pull request when working as the dev team; the owner may push directly.
