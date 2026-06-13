# 🎛 Controller Mapping — Design Doc

> **Status:** reviewed with Sina 2026-06-11 — decisions locked in (see *Decision
> log* at the bottom). Tracked on the Notion board *Titanic Lighting - Task
> Tracker* (cards carry repo task ids `014`–`019`; see
> `.agent/00_gol/14_task_tracking.md`).

## Overview

Today the sim knows *where every fixture is* (3D scene) and *what every fixture is*
(fixture definitions + footprints), but it has **no model of the physical control
hardware**. Patching lives as four loose per-fixture fields in `patches.yaml`
(`controllerIp`, `dmxUniverse`, `dmxAddress`, `controllerId`) that are either hand-typed
on a fixture card or batch-assigned by the auto-patcher — neither of which reflects how
the rig is actually wired on playa: **DMX controllers, each with an IP, each with N
output ports, each port driving fixtures on one universe down a daisy chain.**

This doc designs a **Controller Mapping** window — a sibling of the Views panel
(`docs/27` / `view_masks_editor.js`) — where the operator describes the hardware once
and maps fixtures onto it by clicking, in the 3D view or in a list. Everything the rest
of the pipeline needs (`controllerIp`, `dmxUniverse`, `dmxAddress`, `controllerId`) is
**derived** from the mapping, never hand-typed. The mapper **replaces the auto-patcher
entirely** — it becomes the only patching path in the sim.

The mission constraint that shapes everything below: **on-site mapping must be fast,
visual, and impossible to silently get wrong.** The titanic scene has 61 fixtures to
patch in the dust; the UI must make that a 10-minute click-through, not an
address-arithmetic session. The Views panel set the UI bar — this panel raises it.

### Why now

- The titanic scene currently ships with **all 61 fixtures unpatched**
  (`dmxUniverse: 0`, `controllerIp: ''`).
- On-site repatching of Logsville exposed how fragile per-fixture field editing is
  (see the Notion task "Logsville patches use universe 7 which is not in
  sacn_universes" on the Titanic Lighting - Task Tracker board) — and this design
  **deletes that bug class** by deriving the sACN listen-universe list from the
  mapping (see *sACN universes* below).
- The Views work (PR #11) proved the pattern this doc reuses: **scene-owned YAML →
  panel UI → derived per-fixture fields → existing export pipeline untouched.**

---

## Goals & Non-Goals

**Goals**

1. Model controllers (IP + ports + universes + chains) as first-class scene data.
2. Map fixtures to ports by **selecting in 3D** *or* **picking from a list** — both
   directions stay visually in sync with the 3D view at all times.
3. Auto-derive DMX start addresses from chain order + fixture footprints.
   No address math by hand, ever.
4. **Replace the auto-patcher**: the mapper is the only place patch fields and
   fixture metadata (`sectionId`, `fixtureId`, `controllerId`) are produced.
5. Derive the sACN listen-universe list automatically from the mapping, **scene-owned**
   (moved out of `common.yaml`).
6. Keep the downstream pipeline (model exporter, marsin_engine, sACN output)
   **completely unchanged** — it continues to read the same per-fixture fields.
7. Fail loudly on every invalid state, with **defined projection behavior** for every
   invalid state (no out-of-range address can ever reach `patches.yaml`), per the
   codex P0 rule. No silent fallbacks.

**Non-Goals (v1)**

- No RDM / ArtPoll auto-discovery of controllers (extension point exists in
  `dmx/lib/artnet.js`; wire it later as a "📡 Discover" button).
- ~~No per-fixture manual address pinning inside a normal chain~~ — **superseded
  2026-06-12 by decision 18**: typing an address on a chain chip converts the
  entry to a manual pin (absolute, conflict-tolerant, warn-only). Effects-universe
  pinning remains mandatory — see *Universe 1: effects*.
- No editing of fixture channel modes here — that stays on the fixture card.
- No replacement of the sACN bridge / engine routing; this is a mapping editor only.
- No `protocol` field on controllers (sACN unicast is the only output path today;
  add the field when something actually branches on it).

---

## Concepts & Data Model

```
Controller "Bow PKnight"  (10.1.1.10)          ← physical box, one IP
├── Port 1 → Universe 2            @ 1         ← one DMX output jack
│     chain: Par 1 → Par 2 → Par 3 → Par 4     ← physical daisy-chain order
├── Port 2 → Universe 3            @ 1
│     chain: Vintage Left → Vintage Right
├── Port 3 → Universe 3            @ 200       ← SAME universe, split across ports
│     chain: Vintage Rear
└── Port 4 → Universe 1  (effects) pinned      ← reserved universe, pinned addresses
      Haze 1 @ 510 · Fog 1 @ 512
```

- **Controller** — a physical DMX node. Has a human name, an IP, a **stable `id`**
  (never reused after delete), and an ordered list of ports. **Defaults to 4 ports
  on creation**; ports can be added or removed freely (no enforced maximum).
- **Port** — one DMX output jack. Carries one **universe** number and a
  **`startAddress`** (default `1`) — the channel its chain starts packing from.
  Owns an ordered **chain** of fixture references.
- **Universe sharing** — a universe **belongs to exactly one controller** (one IP —
  the sACN unicast target), but **multiple ports on that controller may carry the
  same universe**: physically, one universe split across two jacks/cable runs. Each
  port packs independently from its own `startAddress`; **editing one port never
  shifts another port's addresses** — if their ranges collide, that is a loud
  validation error, never a silent re-pack.
- **Chain** — the daisy-chain order of fixtures on that port's cable. Order is
  meaningful: it determines DMX start addresses by footprint packing.
- **Fixture reference** — by **fixture name**, the same stable key `patches.yaml`
  already uses (`Par 1`, `Vintage Left`, …). A fixture may appear in **at most one
  chain** across the entire scene. **Renaming a fixture in the sim updates its chain
  reference atomically in the same session** — the registry hooks the rename path,
  so a rename can never orphan a live mapping.

### Allocation rules (the contract — REWRITTEN 2026-06-12, decision 19)

> The original packing model (`addr(chain[k]) = addr(chain[k-1]) +
> footprint(chain[k-1])` from a per-port `startAddress`) is retired.
> Ports are **pure cable topology** — chain order never influences
> addresses, exactly like the physical rig, where addresses live on the
> fixtures and the daisy chain only carries signal.

Every chain entry stores its **absolute address**: `{fixture, at}` /
`{gap, at}`. The address is assigned **once, at add time** — one past the
end of the universe's full occupancy map (all ports, all controllers,
gaps and pins included) — and is sticky thereafter. Removals leave
holes; holes are never reused automatically (waste, never reshuffle) and
stay visible in the per-port universe bars; compaction is a deliberate
operator action (Notion backlog card). Typing in a chip's address box
moves the fixture anywhere; clearing it re-allocates at the universe
end. Drag-moving a chip between ports carries the address along;
remove + re-add allocates fresh. Legacy packed files are converted once
at boot by `migrateLegacyChains()` at exactly their previously derived
addresses, so upgrading moves nothing.

The channel budget is the **full universe: channels 1–512**. There is no
per-universe reserved tail any more — the old `DMX_RESERVED_CHANNELS` ([511, 512]
in every universe) is retired; effects reservation is now the **universe-1 rule**
below.

`footprint()` is the existing definition-registry-aware footprint lookup (today
`auto_patcher.getFootprint()`; it moves into the new registry module when the
auto-patcher is removed). From the mapping, every chained fixture's patch fields
are **projected**:

| Derived field | Source |
|---|---|
| `controllerIp` | owning controller's `ip` |
| `dmxUniverse` | owning port's `universe` |
| `dmxAddress` | packing position in the chain (or pinned address on U1) |
| `controllerId` | owning controller's **panel ordinal** — its 1-based position in the Controller Mapping panel list (`controllers` array order); renumbered on delete/reorder (decision 20). Unmapped → `0`. The internal stable `id` is never projected |
| `sectionId` | per fixture group, stable assignment (absorbed from the auto-patcher's `assignMetadata`) |
| `fixtureId` | monotonic per fixture, stable, never reassigned (absorbed likewise) |

Fixtures not in any chain are **unmapped**: patch fields project to `'' / 0 / 0` —
exactly today's unpatched state, so the existing `patch_manager.js` warnings keep
working.

### Projection under invalid state (the bulletproof rule)

Export is blocked on violations, but scene save stays allowed (work-in-progress is
never lost) — and the projection writes live `patches.yaml` fields that
`patch_manager.js` and the sim's sACN path consume immediately. So every invalid
state has a **defined projection**:

> **A fixture whose derived address cannot be proven valid projects to the
> unpatched state (`''/0/0`), with a loud error. `patches.yaml` can never contain
> an out-of-range or conflicting address.**

Concretely, deterministic and per-violation:

| Invalid state | Projection |
|---|---|
| Chain overflow (a fixture's span would cross channel 512) | that fixture **and every entry after it in the chain** project unpatched |
| Range overlap between same-universe ports | the **higher-numbered port's entire chain** projects unpatched (lower port keeps its addresses — deterministic, no shifting) |
| Orphan chain entry (name no longer resolves) | the orphan consumes nothing; **entries after it in the chain** project unpatched (their physical addresses are no longer certain). One-click resolutions: drop the orphan (chain re-packs, loudly) or fix the name |
| Effects pin violation (wrong address/universe for an effect, or a non-effect on U1) | the offending fixture projects unpatched |
| Duplicate / malformed controller IP | all fixtures on that controller project unpatched |

Valid fixtures around a violation keep working — on playa, the broken part of the
rig goes **visibly dark** while the rest stays up, which is exactly the loud,
recoverable failure we want. Fix the violation and the projection returns
instantly.

### Universe 1: effects (reserved)

**Universe 1 is reserved for global effects** (fog, haze, horns, fire). Enforced
in the mapping:

- Effects are **pinned**, never packed — `{ fixture: <name>, at: <address> }` —
  and a pinned effect may be attached to **any port** (the entry records which
  controller/port the fogger is physically cabled to). The projection ignores
  that port's universe and always emits the pin (`U1:<address>`), and the entry
  consumes **no channels** on the port's own universe. Adding an effect through
  the panel pins it automatically ("auto patch the foggers", operator decision
  2026-06-11); the unmapped tray shows effects (✨) in every pick mode.
- A port carrying universe 1 itself accepts **only** pinned effects entries.
- The canonical pin table stays in `simulation/config.yaml → global_effects`
  (operator-confirmed 2026-06-11):
  **`ChauvetHaze4D` → U1 @ 510 (2 ch → 510–511)**, **`TEFogMachine` → U1 @ 512**.
  No overlap: the Chauvet's 2-channel footprint ends at 511, the TE fogger sits
  alone on 512.
  The mapping **validates every effects entry against this table** — an effect
  fixture mapped anywhere else, or at any other address, is a violation.
- Non-effect fixtures can never be mapped on universe 1; effect fixtures can never
  be mapped on any other universe.
- Effects are exempt from overlap validation among themselves (matching today's
  `validatePatches()` behavior).

### Gap entries

Real rigs sometimes reserve channels mid-chain (a fixture that exists physically but
isn't in the sim, or headroom for later). Rather than manual address pinning, a chain
may contain a **gap pseudo-entry**: `{ gap: 12 }` consumes 12 channels in the packing
and renders as a grey spacer chip in the chain UI. Gap widths must be ≥ 1 (a zero or
negative gap is a schema violation). This keeps the "order + footprints ⇒ addresses"
rule absolute while covering the practical exception.

---

## Persistence: `controllers.yaml`

Scene-owned, next to `views.yaml` and `patches.yaml`:

```yaml
# simulation/scenes/<scene>/controllers.yaml
nextControllerId: 2            # monotonic — guarantees ids are never reused
controllers:
  - id: 1                      # stable, never reused after delete
    name: Bow PKnight
    ip: 10.1.1.10
    ports:
      - port: 1
        universe: 2
        startAddress: 1
        chain:
          - Par 1
          - Par 2
          - Par 3
          - Par 4
      - port: 2
        universe: 3
        startAddress: 1
        chain:
          - Vintage Left
          - gap: 33            # reserved channels (see Gap entries)
          - Vintage Right
      - port: 3
        universe: 3            # same universe as port 2 — split run
        startAddress: 200
        chain:
          - Vintage Rear
      - port: 4
        universe: 1            # effects port — pinned entries only
        chain:
          - fixture: Haze 1
            at: 510
          - fixture: Fog 1
            at: 512
```

**Why a separate file** (not embedded in `patches.yaml`): same reasoning as
`views.yaml` — it's a different *kind* of truth (hardware topology vs. per-fixture
state), it diffs cleanly in git, and `patches.yaml` remains a pure projection target
that the rest of the toolchain reads unchanged.

**Single source of truth:** `controllerIp` / `dmxUniverse` / `dmxAddress` /
`controllerId` / `sectionId` / `fixtureId` in `patches.yaml` become **generated
output** of the mapping (still written, still read by the exporter/engine — but the
panel is where they're *edited*). Fixture cards display them **read-only with a
"derived from Controller Mapping" tooltip**, exactly like the read-only view chips.

### Save / load flow (reuses the PR #11 hardening)

- Registry lives at `window.__controllerRegistry` (mirror of `__viewRegistry`).
- Every mutation: recompute projections in-memory → `markChanged()` → dirty chip →
  refresh metadata panels (fixture cards show new derived patch instantly).
- `exportConfig()` puts the registry into `configTree.controllers`; `save-server.js`
  extracts it to `controllers.yaml` via the existing **atomic write** path
  (temp + rename), same as views.
- Boot: `main.js` fetches `controllers.yaml` (cache-busted), validates, projects onto
  fixture configs **before** first render — so patches.yaml drift is corrected at
  load, loudly logged when a projection differs from the stored field.
- A **present-but-broken** `controllers.yaml` hard-stops the boot (same philosophy
  as views.yaml: continuing would let the next auto-save destroy the operator's
  mapping). A **missing** `controllers.yaml` is the legitimate "no mapping yet"
  state.
- `beforeunload` + `sendBeacon` flush already covers this state since it rides
  `configTree`.

---

## sACN universes: derived, scene-owned (v1)

The hand-maintained `sacn_universes` list moves **out of `common.yaml`** and stops
being hand-maintained:

- **With a mapping:** the scene's listen-universe set is **derived** — the sorted
  unique universes of all mapped ports (universe 1 included when an effects port
  exists). The ⚡ Lighting Engine → 📡 sACN Settings field becomes a **read-only
  display** of the derived list ("derived from Controller Mapping").
- **Without a mapping** (scenes not yet migrated — logsville, dome): the bridge
  uses its existing **patch-derived** universe set (`sacn_bridge.js` already
  computes this; today it's only used when the config value is absent — it becomes
  the defined behavior).
- The `sacn_universes` value is removed from `common.yaml`; any remaining explicit
  value lives at scene level (`scene_config.yaml`) only as a migration artifact and
  is deleted once that scene gets a mapping.
- `patch_manager.js`'s universe-mismatch check stays as a belt-and-braces assertion
  but should never fire again — **this deletes the task-012 bug class** (Logsville
  universe-7 mismatch).

---

## UI Design

The Views panel was nice. This one has to be nicer — it's the panel an exhausted
operator uses at 2am in the dust. Everything below is in service of three feelings:
*I can see what I'm doing*, *I can't break anything silently*, and *I always know
what's left*.

### Entry point

A **🎛 Controllers** button at the bottom of Lighting Controls, next to **👁 Views**.
Opens `#controller-map-panel`, same window chrome, drag, and `.vm-modal` confirm
dialogs as the Views panel. The pointer-down guard in `interaction.js` gets the new
panel ID added (lesson learned: this is the bug class that made the Views panel
"not do much").

### Layout — one screen, no modes

```
┌─ 🎛 Controller Mapping ───────────────────────────────── ✕ ─┐
│ [+ Add Controller]                       Unmapped: 53 ⚠     │
│                                                             │
│ ┌─ Bow PKnight ── 10.1.1.10 ──────────────── [+port] [🗑] ┐ │
│ │ ▸ Port 1 · U2 @1   ████████████░░░░░░  40/512 [👁] [🗑]  │ │
│ │     1 ▪Par 1   11 ▪Par 2   21 ▪Par 3   31 ▪Par 4        │ │
│ │     [+ from selection] [+ from list] [+ gap]             │ │
│ │ ▸ Port 2 · U3 @1   ███░░░░░░░░░░░░░░░  66/512 [👁] [🗑]  │ │
│ │ ▸ Port 3 · U3 @200 ░░░░░██░░░░░░░░░░░  10/512 [👁] [🗑]  │ │
│ │ ▸ Port 4 · U1 ✨effects  Haze@510 Fog@512    [👁] [🗑]  │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ Unmapped fixtures (filter: [______]) ──────────────────┐ │
│ │ ▪ Berg 1   ▪ Berg 2   ▪ Chimney 1   ▪ Sail Strand 3 …   │ │
│ └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

Element notes:

- **Controller card**: editable name + IP (IP validated `a.b.c.d` on blur, red border
  + error chip if malformed or duplicate). `[+port]` appends the next port with the
  next free universe pre-filled. Deleting a controller/port with a non-empty chain
  requires the danger-confirm modal and returns its fixtures to *Unmapped*.
- **Port row**: collapsible. Header shows universe + start address (both
  click-to-edit, validated live), an **occupancy bar** (channels used / 512, red on
  overflow or overlap; the bar is **positioned** — a port starting at @200 shows its
  segment where it actually sits in the universe, so split-universe ports read at a
  glance), an isolation eye, delete. Same-universe ports on a controller get a
  subtle shared color band so the grouping is visible. **Changing a port's
  universe to one other ports already carry (any controller) auto-suggests the
  next free start address** — set into the editable `@` box with a toast, never
  recomputed behind the operator's back; if the universe has no room at the end
  for the port's chain, a **full-universe warning** fires instead and nothing
  moves. Overlap violations carry a one-click **⚡ fix → @N** button. The
  suggestion reads a **running per-universe end map** maintained in the
  projection's single pass (O(1) lookups, no rescans). Controllers and ports are
  **collapsible** (collapsed controllers show a one-line summary); the controller
  list is its own scroll region while the violations banner, unmapped tray and
  save button stay fixed — sized for 15+ controllers and hundreds of fixtures.
- **Chain**: horizontal chips in daisy order, each prefixed with its **computed start
  address**. Chips drag-to-reorder (addresses re-pack live) **and drag across ports**
  to move a fixture to another chain. `✕` on hover to unmap. Gap entries render grey
  with their width, click to edit/remove. Effects-port entries render with a 📌 pin
  and their fixed address; they cannot be reordered or repacked.
- **Unmapped tray**: every fixture in no chain, filterable by name/group. This list
  going to **zero** is the operator's "fully patched" signal — the `⚠` count in the
  header is the same number, and at zero the header flips to a green **✓ fully
  patched** chip.

### The two add flows (the heart of the feature)

**Flow A — pick in 3D, add to port:**
1. With the panel open, multi-select fixtures in the 3D view (existing
   click / shift-click selection — `selectedFixtureIndices`). **Selection order is
   chain order** — the existing `Set` already iterates in insertion order, so click
   order is preserved with no structural change (deselecting and reselecting moves
   a fixture to the end, which is the intuitive behavior).
2. Every port row shows `[+ from selection (n)]` with the live count.
3. Click it → fixtures append to that chain in selection order, addresses pack,
   chips appear, 3D updates (below). Already-mapped fixtures in the selection are
   rejected with a loud toast naming them and their current port — never silently
   skipped, never silently moved.

**Flow B — pick from list, see it in 3D:**
1. Click `[+ from list]` on a port → the Unmapped tray enters *pick mode* for that
   port (port row glows; tray title says "adding to Bow PKnight · Port 1"; the tray
   shows a live **"next: ch 41"** address preview that updates as you add).
2. **Hovering** a tray entry flash-highlights that fixture in 3D (emissive pulse on
   its selection proxy). **Clicking** an entry selects it in 3D (same highlight as a
   manual click) *and* appends it to the chain immediately — one click per fixture,
   in the order you click. `Esc` or clicking elsewhere exits pick mode.

**No group-level add** — on the real rig a single group spans **6–15
controllers** (operator decision, 2026-06-11), so a "map this group to this
port" shortcut would be wrong far more often than right. Mapping is strictly
per-fixture; groups appear only as a *filter* in the unmapped tray (type a group
name, then click through its fixtures in cable order).

Both flows are append-based and incremental: map four pars, look up at the 3D view,
confirm, continue. No staging area, no apply button, no modes beyond the transient
pick mode.

### Undo — mistakes cost one click, not a modal

Destructive *small* operations (unmap a chip, reorder, edit a gap) never modal —
they show a **toast with Undo** (single-step, 10 s): "Removed Par 3 from Port 1 —
Undo". Modals are reserved for the genuinely dangerous (deleting a controller/port
with mapped fixtures). This is the single biggest usability gap in the Views panel
and the cheapest to fix here. `Delete` key unmaps the focused chip; `Esc` always
backs out of whatever transient state you're in.

### 3D feedback (always-on while panel is open)

- **Mapped vs unmapped tint**: unmapped fixtures' selection dots render dimmed/grey;
  mapped ones full-color. The rig visibly "lights up" as you patch — this is the
  single most useful piece of on-site feedback. Clicking the header's unmapped
  count isolates the *unmapped* fixtures in 3D (reusing the Views isolation
  machinery) — "show me what's left".
- **Port isolation eye** (reuse the Views isolation machinery —
  `window.__activePreviewView` generalizes to an arbitrary fixture predicate, or a
  parallel `__activePortPreview` consumed by the same zero-scaling pass in
  `animate.js`): only that port's chain remains visible.
- **Chain polyline**: while a port row is expanded or isolated, draw a thin line
  through its fixtures in chain order with small numbered sprites (1, 2, 3 …). For a
  daisy chain this is the difference between "looks right" and "is right" — you can
  visually walk the cable path.
- Clicking a chain chip selects that fixture in 3D; clicking a mapped fixture in 3D
  scrolls/flashes its chip in the panel. Hover works the same way in both
  directions. Bidirectional, instant.

### Read-only derived fields on fixture cards

The fixture metadata card's patch fields (`controllerIp`, `dmxUniverse`,
`dmxAddress`) become **read-only display** when the fixture is chain-mapped, styled
like the view chips, tooltip: *"Derived from Controller Mapping — Bow PKnight ·
Port 1 · chain position 3. Edit in the Controllers panel."* Unmapped fixtures show
*unpatched* with a button that opens the panel with that fixture pre-staged in pick
mode. This kills the double-entry bug class permanently.

---

## Validation — fail loudly, everywhere

Per the codex: no fallbacks, no silent repair. Every violation renders an error chip
on the offending row *and* blocks model export (`exportConfig` refuses with a toast
listing violations; saving the scene YAML is still allowed so work-in-progress isn't
lost). Every violation also has a **defined projection** (see *Projection under
invalid state*) so live patch fields are never garbage.

| Rule | Failure surfaced as |
|---|---|
| A universe belongs to exactly one controller (one IP) | red chip on both ports, names the collision |
| Same-universe port ranges (startAddress + packed span) must not overlap | both bars red with the overlap region highlighted; higher port's chain struck through (projects unpatched) |
| Chain packing fits within channels 1–512 | occupancy bar red, overflowing chips struck through, export blocked |
| Universe 1 ⇔ effects only; effects pinned per `config.yaml → global_effects` (Chauvet @510, TE Fog @512) | red chip naming the expected pin; offending fixture projects unpatched |
| Fixture in ≤ 1 chain | structurally impossible via UI; load-time validation throws listing duplicates |
| Controller IPs unique + well-formed | red border + chip; controller's fixtures project unpatched |
| Chain references resolve to existing fixtures | load-time: loud console error + panel banner listing orphans; orphans render as red chips, one click to drop; entries after an orphan project unpatched |
| Gap width ≥ 1; `startAddress` in 1–512 | schema violation at load / inline error in UI |
| `controllers.yaml` schema valid | boot throws with file/line context — no partial load |

Load-time validation mirrors the engine's sidecar validation philosophy from PR #11:
a stale `controllers.yaml` must never half-apply.

---

## The auto-patcher is removed

The auto-patcher (`auto_patcher.js`, spec `.agent/00_gol/10_auto_patcher.md`)
invents addresses with no hardware model. With the mapper in place it is **deleted,
not reframed** — the controller mapper is the only patching path:

- **`getFootprint()` / `isGlobalEffect()`** move into the new
  `controller_registry.js` (they're the only parts the mapper needs).
- **`assignMetadata`'s job moves into the projection pass**: `sectionId` (per
  group, stable), `fixtureId` (monotonic, stable, never reassigned), `controllerId`
  (controller's panel ordinal — decision 20). Without this, removing the auto-patcher would leave
  new fixtures with no section/fixture IDs — the projection pass is now the trigger.
- The **global-effects pass** becomes the enforced universe-1 pin rule above —
  visible and editable instead of invisible magic. `config.yaml → global_effects`
  stays as the canonical pin table.
- GUI buttons that call `autoPatchAll` / `clearAllPatches` are removed. "Clear all"
  becomes a danger-modal operation **inside the panel** (clears the mapping, returns
  everything to Unmapped — the projection then writes the unpatched state).
- `.agent/00_gol/10_auto_patcher.md` is retired/rewritten to point here (flagged for
  Sina's sign-off — tracked in task 017).

## Downstream impact

- **Model exporter / marsin_engine / sidecars**: zero change. They read the same
  per-fixture fields the projection writes. (`controllerId` rides the engine's
  `Int32Array` metadata buffer — small 1-based ordinals, no width concern.)
- **sACN output** (`sacn_output_client.js` unicast to `controllerIp`): zero change.
  The "universe belongs to one controller" rule guarantees a universe always
  unicasts to exactly one IP, which is what the output path assumes.
- **sACN listen bridge** (`sacn_bridge.js`): reads the derived universe list (see
  *sACN universes* above) — small wiring change, the patch-derived path already
  exists.

---

## Implementation plan

Tracked on the Notion *Titanic Lighting - Task Tracker* board (repo task ids
`014`–`019` in the card bodies). Each phase is independently
land-able; phases 1+2 alone already beat today's workflow.

| Phase | Task | Scope | Files |
|---|---|---|---|
| 1. Model + persistence | `014` | `controller_registry.js` (create/validate/pack/project — incl. invalid-state projection, effects pins, metadata assignment, rename hook), `controllers.yaml` load in `main.js` (hard-stop on broken file), `configTree.controllers` extraction in `save-server.js`, unit tests for packing/validation/projection | `simulation/src/dmx/controller_registry.js` (new), `simulation/main.js`, `simulation/server/save-server.js` |
| 2. Panel UI | `015` | `controller_map_editor.js` modeled on `view_masks_editor.js`: cards, ports (startAddress, shared-universe bands, positioned occupancy bars), chains, effects pins, unmapped tray, drag-reorder + cross-port drag, undo toasts, modals, pointer-guard ID | `simulation/src/gui/controller_map_editor.js` (new), `simulation/src/core/interaction.js`, `simulation/src/gui/gui_builder.js` (button) |
| 3. 3D linkage | `016` | selection-order capture, pick mode + hover flash, mapped/unmapped tint, unmapped isolation, port isolation, chain polyline + numbered sprites, bidirectional chip↔3D | `interaction.js`, `animate.js`, small `chain_overlay.js` (new) |
| 4. Derived cards + auto-patcher removal | `017` | read-only derived patch display on fixture cards (+ "open in panel" for unmapped), delete `auto_patcher.js` (footprint/effect helpers move to registry), remove legacy GUI buttons, retire spec 10 | `gui_builder.js`, `auto_patcher.js` (deleted), `.agent/00_gol/10_auto_patcher.md` |
| 5. sACN universes | `018` | derive listen list from mapping, scene-owned; read-only GUI display; remove from `common.yaml`; migration for logsville/dome (patch-derived); closes task 012 | `sacn_bridge.js`, `gui_builder.js`, `scenes/common.yaml`, scene configs |
| 6. Verification | `019` | real-UI puppeteer suite (the Views-panel test methodology: drive actual buttons, never APIs), titanic 61-fixture mapping dry run, round-trip identity check on save→load→save, invalid-state projection checks | `~/tmp` scripts, report in `.agent/02_reports/` |

---

## Decision log (Sina + review, 2026-06-11)

1. **Channel budget is 512 everywhere.** No per-universe reserved tail; the old
   `DMX_RESERVED_CHANNELS` convention is retired.
2. **Universe 1 is reserved for special effects**, enforced in the mapping.
   Pins per `config.yaml → global_effects`: ChauvetHaze4D @ U1:510 (2 ch →
   510–511), TEFogMachine @ U1:512.
3. **Invalid states project to unpatched** (`''/0/0`) per the deterministic table
   above — `patches.yaml` never carries an out-of-range or conflicting address.
   (Delegated decision, optimized for loud-but-recoverable production failure.)
4. **A universe may be split across multiple ports of the same controller**, each
   port with its own explicit `startAddress`; ports pack independently and never
   shift each other. One universe never spans two controllers.
5. **`sacn_universes` becomes automatic and scene-owned** — derived from the
   mapping; removed from `common.yaml`. Pulled into v1 (was a follow-up).
6. **The auto-patcher is removed entirely**; the mapper is the only patching path
   and the projection pass owns `sectionId`/`fixtureId`/`controllerId` assignment.
7. **Selection order**: JS `Set` insertion order suffices — no data-structure
   change.
8. **No `protocol` field** in v1 (nothing branches on it).
9. **Port count**: default 4, unbounded.
10. **Universe numbering**: next-free auto-suggest on port add; no base-numbering
    convention.
11. **No group-level port assignment** — a single group spans 6–15 controllers on
    the real rig, so mapping is strictly per-fixture; groups are a tray filter
    only.
12. **Effects attach to any port, auto-pinned** — the entry records the physical
    cabling; the address is always the config.yaml pin on U1 and holds no
    channels on the port's own universe ("auto patch the foggers").
13. **Address suggestions are cache-backed** — a running per-universe end map is
    built in the projection pass; suggestions/full-universe warnings are O(1)
    and consider every port across all controllers.

### Added 2026-06-12 (Sina + cold review)

14. **Identical U1 pin addresses gang-fire** — one address may start multiple
    foggers at the same time, always; never a violation. What IS flagged:
    `pin_overflow` (footprint past 512) and `pin_overlap` (different addresses
    whose footprints collide).
15. **Universes are never reused** — `nextUniverse` is a persisted high-water
    mark like `nextControllerId`. Removing a controller frees nothing for
    later allocation; manually-typed universes bump the mark too. Wasting
    universe numbers is fine; reshuffling existing assignments for a small
    change is not.
16. **A deleted fixture's chain entry becomes an equal-width gap** — every
    entry after it keeps its exact address (the physical fixtures are still
    cabled and addressed). The gap renders in the panel as reserved channels
    the operator removes deliberately. Pinned effects simply drop.
17. **Generator regeneration preserves the mapping** — names are stable per
    index (`<group> N`), so survivors re-project to the same addresses; a
    count shrink gap-replaces the casualties (decision 16); new extras land
    in the Unmapped tray. The "patches will be reset" regen warning is
    skipped under an active mapping because it no longer applies.
18. **Manual pins are the operator's ultimate savior** — typing ANY address on
    a chain chip is absolute and **conflict-tolerant**: overlaps warn (red
    address) but the address ALWAYS projects. Out-of-range (past 512) still
    unpatches; U1 stays effects-only. *(Generalized by decision 19: every
    address is now an explicit pin, so this rule covers everything.)*
19. **The allocation model** (2026-06-12, supersedes the packing model and
    decision 4's per-port startAddress): every entry stores its absolute
    address, assigned once at add time from the end of the universe's FULL
    occupancy map (all ports and controllers — the map is also rendered as
    the universe bar on every port, own claims bright / siblings dimmed /
    conflicts red) and sticky thereafter. Chain order is cable documentation
    only. ALL overlaps warn-and-stand (red), nothing unpatches for conflict;
    hard unpatches remain for past-512, U1 rules, missing definitions,
    orphans, bad/duplicate IPs, and contested universes. Holes from removals
    are never reused automatically — fragmentation is visible in the bars,
    compaction is a deliberate future operator action (Notion backlog card).
    Deleting a fixture simply frees its channels (the former gap-replacement
    rule of decision 16 is obsolete); generator regeneration (decision 17)
    keeps survivors' stored addresses by name. Legacy packed files migrate
    once at boot, atomically per port, at their previously derived
    addresses.
20. **Projected `controllerId` is the panel ordinal** (operator 2026-06-12,
    amends decision 6's "stable id" choice for the PROJECTED field only):
    the value written onto fixture configs / `patches.yaml` / the exported
    engine model — including effects pins — is the owning controller's
    1-based position in the Controller Mapping panel list
    (`registry.controllers` array order). Unmapped fixtures stay `0`.
    Deleting or reordering controllers renumbers projected ids on the next
    projection — explicitly the operator's intent ("defined as the order of
    the controllers in the panel"); the stable internal `id` (monotonic,
    never reused) is unchanged and keeps keying `portLayouts`, violations,
    panel collapse state, and chain ownership.

*(No open questions — the Chauvet/TE pin overlap was resolved 2026-06-11 by
moving the Chauvet to 510–511, and is mechanically flagged since decision 14.)*
