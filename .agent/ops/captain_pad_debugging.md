# CaptainPad Debugging — where the logs are, and the known traps

How to see what CaptainPad is doing without asking the operator to relay
red-screen text. Applies to the dev stack started by `launcher.js`.

## Where each log lives

| Surface | Where to look |
|---|---|
| **Metro / Expo bundler** (bundle builds, module resolution) | stdout of the **launcher process**, lines prefixed `[captainpad]`. When the launcher runs as a coordinator background task, grep its task output file. The iPad's red-screen `Unable to resolve module X` appears here **with the full import stack** — the device shows a truncated version of this same log. |
| **Device runtime JS** (console.log/error, exceptions after the bundle loads) | Forwarded to the same Metro stdout in dev mode — same `[captainpad]` prefix. |
| **Engine / sim / companion** | Same launcher stdout, prefixed `[engine]`, `[sim]`, `[companion]`. |
| **Web CaptainPad** (:6967 — prod's static dist, or a dev profile's Metro) | Browser devtools console. `tools/static_web_server.cjs` has no useful server-side log. |
| **Native CaptainPad** (Expo Go) | The launcher-owned `captainpad-native` Metro (`--with-native-pad`, `:6981`), prefixed `[captainpad-native]` in the same launcher stdout. |

Search recipe against the launcher output (task output file or terminal
scrollback):

```bash
grep -n -A 6 "Unable to resolve\|ERROR\|\[captainpad\]" <launcher-output> | tail -60
```

## Probes that don't need the device

Check the Expo Go manifest (host must be the LAN IP, never localhost):

```bash
curl -s -H "expo-platform: ios" http://127.0.0.1:6967/ | head -c 400
```

Force a bundle build and see the error without an iPad — a bundling failure
returns non-200 and the error as JSON in the body:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:6967/node_modules/expo-router/entry.bundle?platform=ios&dev=true"
```

Verify a "missing" module actually exists on disk before believing Metro:

```bash
ls CaptainPad/node_modules/<package>/<path-metro-claims-is-missing>
```

## Known traps on this machine (each has burned a session)

- **A scratch CaptainPad dist STILL talks to the LIVE engine.**
  `utils/apiBase.ts` derives the engine as `window.location.hostname:6968`
  with the port HARD-PINNED, so a page served from any scratch port resolves
  to the live `:6968` — and the app fires real writes during its very first
  mount (a mixer-screen mount POSTs `/layers/activate`). Pinning API_BASE
  after load is NOT enough. **Every probe must: load a NON-APP static path
  first (e.g. `/favicon.ico`), set the API_BASE override there, and only
  then navigate to an app route.** One mistimed navigate = a write to the
  live rig (it happened 2026-08-16: a probe flipped the live active layer).
- **Never probe/bind non-standard loopback addresses** (`127.0.0.2`,
  `127.0.0.3`, …). On this box each one fires a manual sandbox permission
  prompt the operator must click — a blocking action (operator order,
  2026-08-16). Use `127.0.0.1`/`localhost` for local probes and scratch
  serves; use `192.0.2.x` (TEST-NET-1) as the black-hole/dead destination;
  a second local listener gets a different **port** on `127.0.0.1`, never a
  different loopback IP. An unbound `127.0.0.1` port is a fine "dead engine".

- **Two Wi-Fi clients that can't see each other → suspect the ROUTER, then
  reboot it.** Diagnosed 2026-08-16: iPad ↔ PC totally dead at layer 2 (no ARP
  reply, `Destination host unreachable`) while BOTH could reach the router and
  wired devices — the router had wedged wireless client-to-client forwarding,
  and a router reboot fixed it instantly. Diagnostic ladder that found it:
  `arp -a` (is the peer resolved at all?) → `ping` both directions → check
  what DOES work (router, wired peers). Don't burn time on iOS Local Network
  permission or Expo internals until ARP itself resolves. Separately: the
  native-pad Metro must run `expo start --go` — expo-dev-client in CaptainPad's
  deps otherwise flips the default to Development Build mode and Expo Go times
  out on a perfectly healthy Metro (fixed in launcher.js + pinned by a
  launcher_supervision test).
- **Stale Metro file map.** A Metro started **before** an `npm install` (or
  large file wave) reports `Unable to resolve module X` even though the file
  is on disk. Diagnosis: the `ls` probe above finds the file.
  **The launcher now clears that cache for you** (docs/62 W-B2): before every
  Metro start it fingerprints `CaptainPad/package-lock.json` + the installed
  tree marker and passes `expo start --clear` when it changed, logging
  `Metro cache: dependencies changed since the last Metro start → cache
  cleared`. A `package-lock.json` NEWER than `node_modules/.package-lock.json`
  makes it refuse to boot at all, naming `npm install`. So if you see
  Unable-to-resolve for a file that exists, **the guard was bypassed** — find
  out who started that Metro, because it was not `launcher.js`.
- **Metro is a launcher child.** Killing it can tear the whole stack down
  (engine + sim included). Check `~/tmp/bm26_bench_mirror_armed.json` first —
  an armed bench session dies with the engine. The clean path is a full
  launcher bounce, not a surgical Metro kill. Sanctioned stops and the sentinel
  reaper: `.agent/ops/stack_lifecycle.md`.
- **The Expo Go Metro is `:6981`, and it is launcher-owned.** A show profile
  serves the web pad from the prebuilt dist, which Expo Go cannot load — so the
  native path is `node launcher.js prod --with-native-pad`, tag
  `captainpad-native`, in the lock, in `status`, torn down with everything else.
  Never hand-run a background `expo start` for it: that is a straggler by
  construction, and it skips the cache guard above.
- **Expo Go caches bundles.** After any Metro restart, kill Expo Go from the
  iPad app switcher before reopening, or it may replay the cached (broken)
  bundle.
- **`CI` must be UNSET** for anything Expo (`env -u CI ...`). `CI=""` (empty
  string) crashes Expo with `GetEnv.NoBoolean`; `CI=1` freezes reloads.
- **One Metro per project.** Two Metros race `node_modules/.cache` and both
  misbehave.
- **`expo export` under Git Bash** can write output to a stray
  `C:\c\Users\...` path via `$HOME` confusion — verify where the dist landed,
  and don't export while a live Metro is still warming up.
- **Parallel `expo export` runs corrupt the metro cache** and produce a
  blank-page bundle that looks exactly like a product crash (cost a full
  debug cycle, report `_259`). One export at a time, machine-wide; agents
  export to scratch dirs, never into `CaptainPad/dist` when a static server
  is serving it live.
  **`node launcher.js rebuild-pad` is the ONE path that refreshes
  `CaptainPad/dist`** (docs/62 W-C1) and it enforces exactly that: it refuses
  over another `rebuild-pad`, over any `expo export` running elsewhere on the
  box, and over a launcher Metro that has not finished warming up. Do not run
  `npm run web:build` into the live dist by hand.
- **The apostrophe in this box's profile path breaks `expo export
  --output-dir`.** A `~/tmp/...` target expands through `Titanic's End`;
  Expo prints `Exported: ...` while writing nothing recoverable. Use the 8.3
  short path `C:/Users/TITANI~1/tmp/...` instead — same defect class as the
  launcher's unquoted-spawn bug (`_256`/`_260`). After ANY export, verify
  the output dir actually has a fresh `index.html` before serving it.
- **Hot reload broadcasts agents' mid-edit states** to any connected pad.
  Agents editing CaptainPad keep every save parseable; on a dev profile,
  operators wanting a stable surface run an **ephemeral** in-session
  `tools/static_web_server.cjs` on a 71xx port beside the Metro and kill it
  before the session ends. There is **no standing dist mirror** (docs/62 W-B3,
  D4): on a show profile, `:6967` IS the dist through that same server, so the
  retired `:7175` has nothing left to do.

## Connecting an iPad (Expo Go)

Give the operator a scannable QR for the live Metro URL instead of a string
to type: follow `.agent/skills/expo_go_qr.md` (offline-safe, uses the
vendored `qrcode-terminal` module matrix — never parse its terminal output).
Remember Expo Go's recents list goes stale when the Metro port/host changes;
after any Metro move the operator must scan the new QR or use "Enter URL
manually", and kill Expo Go from the app switcher first so a cached bundle
can't replay.
