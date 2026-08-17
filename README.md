# 🚢 Titanic — Burning Man 2026

Lighting stack for the **Titanic** structure at Burning Man 2026: a browser 3D
sim, a Pixelblaze-compatible rendering engine, an iPad control surface, and an
audio analyzer — one launcher brings up all of it and drives the physical rig
over sACN.

> *Make it glow. Make it welcoming. Make it fun.*

This README is **the on-playa operations guide**: everything you do from the
machine running the engine, and everything you do from the debug laptop on the
camp LAN. There is **no internet on the playa** — every step here works
offline; the only online steps are the pre-playa installs marked as such.

### 🌐 [**Live Demo →**](https://sina-cb.github.io/BM26-Titanic/simulation/?scene=test_bench&profile=full&spotlights=60)

---

## Table of Contents

- [Quick Start (engine machine)](#-quick-start-engine-machine)
- [Services and Ports](#-services-and-ports)
- [Profiles: prod vs dev](#-profiles-prod-vs-dev)
- [`--no-launch` and auto-open](#-no-launch-and-auto-open)
- [Running Services Individually](#-running-services-individually)
- [Debug Laptop and iPads (LAN)](#-debug-laptop-and-ipads-lan)
- [Monitoring and Health](#-monitoring-and-health)
- [Deploying to the Show Box](#-deploying-to-the-show-box)
- [Troubleshooting Quick Hits](#-troubleshooting-quick-hits)
- [Rendering the Sim (screenshots)](#-rendering-the-sim-screenshots)
- [Repository Structure](#-repository-structure)
- [Mission](#-mission)

---

## 🚀 Quick Start (engine machine)

**One-time setup (online, before the playa):**

```bash
git clone git@github.com:sina-cb/BM26-Titanic.git && cd BM26-Titanic
git config core.hooksPath .githooks    # security pre-commit hook
node launcher.js setup                 # npm install in simulation/, marsin_engine/, CaptainPad/
```

There is no root `package.json` — dependencies live per-subsystem, and `setup`
installs all three. Python 3 (stdlib only, no pip installs) is needed for
`scripts/security_check.py` and `deploy/deploy.py`.

**Environment:** the launcher requires `BM26_SECRETS` to point at the private
deployment `secrets.yaml` (CaptainPad operator passphrases). It validates this
before starting anything and fails loudly if missing.

**Build the CaptainPad static export** (required for `prod` — it refuses to
start without `CaptainPad/dist/index.html`):

```bash
node launcher.js rebuild-pad
```

This is the ONE path that refreshes `CaptainPad/dist`: it is serialized against
any other export on the box (parallel `expo export` runs corrupt the metro cache
and emit a blank-page bundle), and it works while the stack is running — the
static server reads from disk, so an iPad reload picks the new build up with no
restart.

**Launch the show stack:**

```bash
node launcher.js prod --scene titanic
```

What you should see, in order:

```
✅ Simulation is ready.
✅ Engine is ready.            ← plus: [sACN Out] Sender started — … priority 150 …
✅ Audio Companion is ready.
✅ CaptainPad is ready (static build).
🚀 Stack is up (profile: prod)
```

**Ctrl+C** stops everything. From another terminal: `node launcher.js status`
/ `node launcher.js stop` (stop asks the engine for its blackout frame first —
lights go dark before the kill).

---

## 🔌 Services and Ports

Every profile brings up the same five services (one stack, standard ports —
never run a second stack on shuffled ports):

| Service | Port(s) | What it is |
|---|---|---|
| Simulation | `:6969` HTTP · `:6970` save · `:6971` sACN-in bridge · `:6972` sACN-out bridge · UDP `5568` E1.31 | Three.js 3D preview; receives the engine's sACN and relays to LED controllers |
| MarsinEngine | `:6968` REST/WS · `GET /status` | Pattern engine (WASM VM, 40 fps), sACN out, CPC parameter API |
| CaptainPad | `:6967` | Operator control surface (web + Expo) |
| Audio Companion | `:6966` HTTP/WS · OSC → engine UDP `:10000` | The sole audio analyzer; feeds band/BPM signals into the engine CPC |

```text
CaptainPad (:6967) ──ws/http──▶ MarsinEngine (:6968) ──sACN──▶ sim bridges (:6971/:6972) ──▶ Browser sim + physical rig
Audio Companion (:6966) ──OSC :10000──▶ MarsinEngine
```

Startup order (the launcher enforces it): sim → engine → companion →
CaptainPad. Full chain verification: `.agent/skills/full_stack_smoke.md`.

---

## 🎛 Profiles: prod vs dev

```bash
node launcher.js prod            # show box
node launcher.js dev             # dev laptop
node launcher.js dev-lite        # dev on a weak GPU
```

| | `prod` | `dev` | `dev-lite` |
|---|---|---|---|
| **Intended use** | show machine, on playa | development laptop | dev without fancy lighting |
| **Processes** | sim + engine + audio companion + CaptainPad | same | same |
| **Sim lighting profile** | `2d_pixels` — 2D pixel map only, every per-frame GPU 3D pass skipped (FPS goes to the rig) | `full` — analytic lighting, 60 spotlights | `emissive` — no spotlights |
| **sACN priority** | **150** | 120 | 120 |
| **CaptainPad serving** | **static** prebuilt `dist/` via `tools/static_web_server.cjs` — no Metro, nothing recompiles mid-show | **Expo dev server** (Metro, hot reload) | Expo dev server |
| **Preconditions** | `CaptainPad/dist/index.html` exists (else refuses to start) | `CaptainPad/node_modules` + an unambiguous LAN address (or `--lan-host`) | same as dev |
| **Port claiming** | **force-claims by default** — kills anything on stack ports | refuses foreign port holders unless `-f` | same as dev |
| **Auto-open** | sim + CaptainPad + Companion (suppressed by `--no-launch`; the show-box boot chain passes it) | sim + CaptainPad + Companion — 3 windows on the desktop | same as dev |

Prod outranks dev on sACN **on purpose**: if a dev laptop and the show server
ever address the same universes, receivers lock to the higher priority and the
show server (150) wins.

Common options: `--scene <name>` (sim scene AND engine model, default
`titanic`), `--pattern <name>`, `--sim-profile <id>`, `--sacn-priority <n>`,
`--lan-host <addr>`, `--with-native-pad` (see below), `--split` (tile sim +
CaptainPad in two Chrome windows), `-f/--force`, `--no-kill`, `--no-launch`.
Full list: `node launcher.js --help`.

**iPad over Expo Go on a show profile: `--with-native-pad`.** `prod` serves the
web pad from the prebuilt dist, which Expo Go cannot load — it needs a Metro. So
`node launcher.js prod --with-native-pad` adds a **supervised** `captainpad-native`
child on `:6981` (`captainpad_native_port`): health row in `status`, entry in the
lock, torn down with everything else, and the startup summary prints the
`exp://<lan-host>:6981` line to scan. It is refused by name on `dev`/`dev-lite`,
which already run the one Metro this project may have. Never hand-run a
background `expo start` for it — that is a straggler by construction.

Before starting any Metro the launcher fingerprints CaptainPad's dependency
state and passes `expo start --clear` when it changed (the stale-Metro guard: a
Metro older than the last `npm install` reports `Unable to resolve` for files
that exist). A `package-lock.json` newer than the installed tree refuses the
boot, naming `npm install`.

CaptainPad on `prod` is **show-critical**: if `:6967` cannot be served, the
launcher tears the whole stack down, same as an engine death. Build the dist
before every deploy.

**Stopping and keeping it current.** There are exactly three sanctioned stops —
Ctrl+C in the launcher's own terminal, `node launcher.js stop`, or a `-f`
takeover; a detached sentinel reaps the stack if the launcher dies any other
way. Engine/sim/companion changes need a bounce (check the bench arm marker
first); a CaptainPad-web change on `prod` needs only `rebuild-pad` + an iPad
reload. Full rules and the per-profile cadence table:
[`.agent/ops/stack_lifecycle.md`](.agent/ops/stack_lifecycle.md).

---

## 🙈 `--no-launch` and auto-open

By default the launcher, once every service is confirmed up, auto-opens the
profile's UIs in your browser — **sim, CaptainPad, Audio Companion**, in that
order. On a dev machine that is the "3 apps on the desktop" experience.

`--no-launch` (alias `--no-open`) starts **all the same servers** but opens
nothing — the URLs are still printed. Use it when you already have the tabs
open, or on a headless box.

The show box uses it in its boot chain: **power-on → autologon `titanic` →
scheduled task `BM26TitanicStack` → `boot_server.ps1` → `node launcher.js prod
--scene <s> --no-launch`** — `boot_server.ps1` opens the show console's own
windows, so the launcher must not race it with duplicates.

---

## 🔧 Running Services Individually

The launcher is the normal path. Run a piece by hand when you're working on
just that piece:

**Simulation only** (sim work, screenshots, scene editing):

```bash
cd simulation && npm start        # :6969 + save + both sACN bridges
# then open http://localhost:6969/simulation/?scene=titanic&profile=edit
```

**Engine only** (pattern development, headless testing):

```bash
cd marsin_engine
node engine.js --model test_bench --pattern 00_golden_hour_wash
node engine.js --list_mics                        # mic options for audio-reactive work
node engine.js --choose_mic --model test_bench    # save a mic for this scene
```

**CaptainPad only** (UI development):

```bash
cd CaptainPad
npm start -c                      # Expo dev server, clears Metro cache, prints QR for Expo Go
```

Refresh the static export (`dist/`, what `prod` serves) through the launcher —
`node launcher.js rebuild-pad` — never `npm run web:build` into a dist a server
is serving live.

**Audio Companion only** (tuning the analyzer):

```bash
cd marsin_engine
node audio/companion/companion_server.js --port 6966 --model <scene> --host 0.0.0.0
```

It binds loopback by default; `--host 0.0.0.0` (what the launcher passes) makes
it reachable from the iPad/laptop on the LAN.

Per-component depth: [`simulation/README.md`](simulation/README.md),
[`marsin_engine/README.md`](marsin_engine/README.md),
[`CaptainPad/README.md`](CaptainPad/README.md).

---

## 📱 Debug Laptop and iPads (LAN)

Everything binds `0.0.0.0`, so any device on the camp LAN reaches the engine
machine by its LAN address:

| From the laptop / iPad | URL |
|---|---|
| CaptainPad | `http://<engine-machine>:6967/` |
| Simulation | `http://<engine-machine>:6969/simulation/` |
| Engine status | `http://<engine-machine>:6968/status` |
| Audio Companion | `http://<engine-machine>:6966/` |

**CaptainPad finds the engine by itself**: the app derives the engine address
from the host it was served from (load it from `<engine-machine>:6967` and it
talks to `<engine-machine>:6968` — nothing to type). The CONFIG tab shows which
source won, accepts an explicit per-device override, and **RESET TO DEFAULT**
returns to derivation.

**Expo Go (dev profile)**: the launcher detects the machine's LAN IPv4 at
runtime and hands it to Metro, so the QR code and bundle URL carry the LAN
address, not loopback. If the machine has several candidate interfaces the
launcher refuses to guess — disambiguate with `--lan-host <addr>` or
`BM26_LAN_HOST=<addr>`.

---

## 🩺 Monitoring and Health

**Launcher supervision** — the launcher watches every child. Any child dying
(engine, sim, companion, CaptainPad — all of them, on every profile) tears the
whole stack down loudly; there are no silent restarts and no zombies. One
exception: the engine exiting with code 75 is a **tracked scene switch** — the
launcher restarts it on the new model and keeps the stack up.

**`node launcher.js status`** probes every child (sim http, save, both sACN
bridges, engine, CaptainPad) **and reads frame-flow** from the input bridge —
`~N sACN packets/5s from '<source>'` — so it never reports green on a dark rig.

**Engine API**: `GET http://<engine-machine>:6968/status` returns the engine's
model, pattern, and runtime info as JSON.

**Log lines worth knowing:**

| Line | Meaning |
|---|---|
| `[sACN Out] Sender started — N universe(s), priority 150, …` | Engine is emitting; verify the priority matches the profile (150 prod / 120 dev) |
| `🪞 BENCH MIRROR ARMED / DISARMED …` | The sim bridge is (or stopped) mirroring a scene onto bench hardware |
| `🪞 bench mirror burst skew — …: N frame(s) in the last X s` | **Benign** rollup (≤1 line/10 s) of transient frame tears — no action |
| `NO whole frame for X s` + `PERSISTENT multi-step offset` | The real STUCK verdict — check for a dead source, a second writer, or a disarm/re-arm; do **not** reflexively restart the engine |
| `[EnginePriority] …` | Engine OS-priority self-elevation (default HIGH) |

**State on disk**: the engine persists runtime state in tracked
`marsin_engine/states/` files — expected residue, never silently revert it. The
launcher's lock lives at `~/tmp/bm26_titanic_launcher.lock.json`.

---

## 📦 Deploying to the Show Box

The show servers are managed from the laptop with `deploy/deploy.py`. Machine
addresses and credentials live in the **private BM26-Firmware-Deployment
repo** (`machines.yaml` via `$BM26_MACHINES`, plus `$BM26_SECRETS` /
`$BM26_DEPLOY_REGISTRY`) — never in this public repo. Test suites and agent
worktrees are excluded from the sync.

The distilled checklist (exterior-lights box = machine key `titanic-ext`):

```bash
# 1. Build the CaptainPad export — prod refuses to start without it
node launcher.js rebuild-pad

# 2. Confirm reachability + node parity (node_modules ship as-is)
ssh titanic@<show-box> hostname && ssh titanic@<show-box> node --version

# 3. Dry run — changes nothing; preview must NOT mention tests\, .claude\worktrees\,
#    marsin_engine\states\ or reports_local
cd deploy && python deploy.py deploy --machine titanic-ext --dry-run

# 4. Real deploy: stops the stack (engine sends its blackout frame first — lights
#    go OFF), robocopy /MIR sync, manifest + overlay, restarts the boot task, verifies
python deploy.py deploy --machine titanic-ext
```

**Verify** after a deploy: `:6969/simulation/` answers · `:6968/status` shows
the right scene · `:6967/` loads CaptainPad · `:6966/` answers ·
`node launcher.js status` on the box shows every row ✅ with frames > 0 · the
engine log shows `priority 150`.

**Rollback**: `python deploy.py deploy --machine titanic-ext --restart-only`
(stop + start + verify, touches no files — clears a bad runtime state). Full
rollback: restore the last known-good tree on the laptop and re-deploy —
`/MIR` makes the server match the laptop. Lights off now:
`python deploy.py stop --machine titanic-ext`.

Server bring-up from bare Windows, SSH keys, autologon, boot task:
[`deploy/CHEATSHEET.md`](deploy/CHEATSHEET.md) ·
[`deploy/README.md`](deploy/README.md) ·
[`docs/43_show_server_deployment.md`](docs/43_show_server_deployment.md).

---

## 🚑 Troubleshooting Quick Hits

| Symptom | Fix |
|---|---|
| Launcher refuses: port held by a foreign process | Free it, or `-f/--force` (prod already forces). A UDP `5568` squatter is claimed by default — anything holding it silently darks the rig |
| `prod` refuses to start | Missing `CaptainPad/dist/index.html` → `node launcher.js rebuild-pad`; or `BM26_SECRETS` missing/invalid |
| Prod boot warns "STALE CaptainPad build" | Sources are newer than `dist/` → `node launcher.js rebuild-pad` + reload the iPad. It is a warning, never a refusal — launching a known-good older build stays possible |
| `rebuild-pad` refuses | Another export, or a Metro still warming, is in flight — parallel exports corrupt the metro cache. Wait and rerun; it names what it is waiting on |
| "A stack is already running" | `node launcher.js stop`, or `-f` to take it over |
| Metro serves a stale/frozen bundle | A `CI=true` shell freezes Metro's reloads — the launcher strips `CI` from every Metro it starts, but a hand-run `expo start` won't; unset `CI` and let the launcher own the Metro. `Unable to resolve` for a file that exists means the launcher's dependency-fingerprint guard was bypassed — find out who started that Metro |
| Expo: iPad downloads bundle from 127.0.0.1 | The LAN host was ambiguous — `--lan-host <addr>` or `BM26_LAN_HOST=<addr>` |
| Live Touch shows "PIXEL VIEW UNAVAILABLE" | Scene camera/pan/zoom edits invalidate the pre-resolved artifact → `cd simulation && npm run pixel-views:export`, then reload the tab |
| Bench mirror looks stuck | Burst-skew rollup lines are benign. Only the STUCK verdict (`NO whole frame …` + `PERSISTENT multi-step offset`) is real — check dead source / second writer / disarm-re-arm; don't restart the engine on old advice |
| Launcher won't kill the sACN bridge | It's protecting an **ARMED** bench mirror. Override only if you accept every mirrored box freezing on its last frame: `--force-sacn` or `BM26_FORCE_SACN_KILL=1` |
| Sim scene switch | Do it in the sim UI — the engine restarts itself on the new model (exit 75, tracked); not a crash |

---

## 📸 Rendering the Sim (screenshots)

The sim ships a Puppeteer renderer at
[`simulation/agent_tools/agent_render.cjs`](simulation/agent_tools/agent_render.cjs)
for capturing the 3D view headlessly. Start the sim first (`cd simulation &&
npm start`), then:

```bash
cd simulation/agent_tools
node agent_render.cjs                       # all preset views
node agent_render.cjs --view front          # a single named view
node agent_render.cjs --show-ui             # keep menus/panels in the capture
node agent_render.cjs --viewport 1280x720   # use on software-GL / headless machines
```

On headless machines, wrap with `xvfb-run -a` and prefer `--viewport 1280x720`
(SwiftShader can lose the WebGL context at 1080p on close-up views). Output
PNGs land in the gitignored `.agent_renders/` directory at the repo root.

---

## 📂 Repository Structure

```text
BM26-Titanic/
├── launcher.js          # One-command stack launcher (profiles, supervision, status/stop)
├── tools/               # static_web_server.cjs, port_cleanup.cjs, process_priority.cjs, …
├── simulation/          # Interactive 3D lighting sim (Three.js + sACN)
├── marsin_engine/       # WASM MarsinVM Pixelblaze rendering engine (sACN out, REST/WS API)
├── CaptainPad/          # React Native/Expo control surface (iPad + web)
├── deploy/              # Show-server bring-up + deploy tooling (deploy.py, CHEATSHEET.md)
├── control_podium/      # Podium hardware + Raspberry Pi bridge (Meshtastic radio path)
├── LookingGlass/        # Control-panel art piece (ESP32 firmware; flash via its deploy.py ONLY)
├── marsin_pb/           # Pixelblaze-related tooling
├── 3d_models/ 3d_structure/ renders/ images/   # Assets
├── states/ docs/ archived/                     # State files, design docs, retired work
└── .agent/              # Agent OS — codex, specs, ops, skills, memory, reports
```

Key docs: [sACN architecture](docs/11_sim_sacn_integration.md) ·
[MarsinEngine](docs/12_marsin_engine.md) · [CPC](docs/15_central_param_center_cpc.md) ·
[CaptainPad](docs/16_captain_pad.md) · [OSC](docs/24_osc_integration.md) ·
[Audio analysis](docs/25_marsin_audio_analysis.md) ·
[Show-server deployment](docs/43_show_server_deployment.md).

---

## 🎯 Mission

- Make the **Titanic exterior** highly visible, beautiful, and interactive at night *(mission critical)*
- Light the **rooms** for our passengers · strike in under **2 hours**
- Strict **Color Bible** (deep blues, ambers, disciplined gradients)
- Be **welcoming**, be **kind**, have **fun**

---

## 👤 Maintainer

**Sina Solaimanpour**
