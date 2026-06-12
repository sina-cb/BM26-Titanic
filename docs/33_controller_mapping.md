# 🎛 Controller Mapping — Design Doc

## Overview

Today the sim knows *where every fixture is* (3D scene) and *what every fixture is*
(fixture definitions + footprints), but it has **no model of the physical control
hardware**. Patching lives as four loose per-fixture fields in `patches.yaml`
(`controllerIp`, `dmxUniverse`, `dmxAddress`, `controllerId`) that are either hand-typed
on a fixture card or batch-assigned by the auto-patcher — neither of which reflects how
the rig is actually wired on playa: **DMX controllers, each with an IP, each with N
output ports, each port driving one universe down a daisy chain of fixtures.**

This doc designs a **Controller Mapping** window — a sibling of the Views panel
(`docs/27` / `view_masks_editor.js`) — where the operator describes the hardware once
and maps fixtures onto it by clicking, in the 3D view or in a list. Everything the rest
of the pipeline needs (`controllerIp`, `dmxUniverse`, `dmxAddress`, `controllerId`) is
**derived** from the mapping, never hand-typed.

The mission constraint that shapes everything below: **on-site mapping must be fast,
visual, and impossible to silently get wrong.** The titanic scene has 61 fixtures to
patch in the dust; the UI must make that a 10-minute click-through, not an
address-arithmetic session.

### Why now

- The titanic scene currently ships with **all 61 fixtures unpatched**
  (`dmxUniverse: 0`, `controllerIp: ''`).
- On-site repatching of Logsville exposed how fragile per-fixture field editing is
  (see the Notion task "Logsville patches use universe 7 which is not in
  sacn_universes" on the Titanic Lighting - Task Tracker board).
- The Views work (PR #11) proved the pattern this doc reuses: **scene-owned YAML →
  panel UI → derived per-fixture fields → existing export pipeline untouched.**

---

## Goals & Non-Goals

**Goals**

1. Model controllers (IP + ports + universes + daisy chains) as first-class scene data.
2. Map fixtures to ports by **selecting in 3D** *or* **picking from a list** — both
   directions stay visually in sync with the 3D view at all times.
3. Auto-derive DMX start addresses from daisy-chain order + fixture footprints.
   No address math by hand, ever.
4. Keep the downstream pipeline (model exporter, marsin_engine, sACN output)
   **completely unchanged** — it continues to read the same per-fixture fields.
5. Fail loudly on every invalid state (universe overflow, double-mapping, IP
   collisions) per the codex P0 rule. No silent fallbacks.

**Non-Goals (v1)**

- No RDM / ArtPoll auto-discovery of controllers (extension point exists in
  `dmx/lib/artnet.js`; wire it later as a "📡 Discover" button).
- No per-fixture manual address pinning inside a chain (chains pack; if you need a
  gap, model it — see *Gap entries* below).
- No editing of fixture channel modes here — that stays on the fixture card.
- No replacement of the sACN bridge / engine routing; this is a mapping editor only.

---

## Concepts & Data Model

```
Controller "Bow PKnight"  (10.1.1.10)          ← physical box, one IP
├── Port 1 → Universe 2                        ← one DMX output jack
│     chain: Par 1 → Par 2 → Par 3 → Par 4     ← physical daisy-chain order
├── Port 2 → Universe 3
│     chain: Vintage Left → Vintage Right
├── Port 3 → Universe 4
│     chain: Bar Left → Bar Right
└── Port 4 → Universe 5
      chain: (empty)
```

- **Controller** — a physical DMX node. Has a human name, an IP, and an ordered list
  of ports. **Defaults to 4 ports on creation**; ports can be added or removed.
- **Port** — one DMX output. Carries exactly **one universe number** (globally unique
  across the whole scene — one universe never spans two ports). Owns an ordered
  **chain** of fixture references.
- **Chain** — the daisy-chain order of fixtures on that port's cable. Order is
  meaningful: it determines DMX start addresses by footprint packing.
- **Fixture reference** — by **fixture name**, the same stable key `patches.yaml`
  already uses (`Par 1`, `Vintage Left`, …). A fixture may appear in **at most one
  chain** across the entire scene.

### Derivation rules (the contract)

For each port, addresses pack first-fit in chain order, starting at 1:

```
addr(chain[0]) = 1
addr(chain[k]) = addr(chain[k-1]) + footprint(chain[k-1])
```

`footprint()` is the existing `auto_patcher.getFootprint()` (definition registry,
channel mode aware). From the mapping, every chained fixture's patch fields are
**projected**:

| Derived field | Source |
|---|---|
| `controllerIp` | owning controller's `ip` |
| `dmxUniverse` | owning port's `universe` |
| `dmxAddress` | packing position in the chain |
| `controllerId` | owning controller's stable `id` (replaces today's "unique int per IP" heuristic) |

Fixtures not in any chain are **unmapped**: fields project to `'' / 0 / 0` — exactly
today's unpatched state, so the existing `patch_manager.js` warnings keep working.

### Gap entries

Real rigs sometimes reserve channels mid-chain (a fixture that exists physically but
isn't in the sim, or headroom for later). Rather than manual address pinning, a chain
may contain a **gap pseudo-entry**: `{ gap: 12 }` consumes 12 channels in the packing
and renders as a grey spacer chip in the chain UI. This keeps the "order + footprints
⇒ addresses" rule absolute while covering the practical exception.

---

## Persistence: `controllers.yaml`

Scene-owned, next to `views.yaml` and `patches.yaml`:

```yaml
# simulation/scenes/<scene>/controllers.yaml
controllers:
  - id: 1                      # stable, never reused after delete
    name: Bow PKnight
    ip: 10.1.1.10
    protocol: sacn             # sacn | artnet (informational for now; output path unchanged)
    ports:
      - port: 1
        universe: 2
        chain:
          - Par 1
          - Par 2
          - Par 3
          - Par 4
      - port: 2
        universe: 3
        chain:
          - Vintage Left
          - gap: 33            # reserved channels (see Gap entries)
          - Vintage Right
      - port: 3
        universe: 4
        chain: []
      - port: 4
        universe: 5
        chain: []
```

**Why a separate file** (not embedded in `patches.yaml`): same reasoning as
`views.yaml` — it's a different *kind* of truth (hardware topology vs. per-fixture
state), it diffs cleanly in git, and `patches.yaml` remains a pure projection target
that the rest of the toolchain reads unchanged.

**Single source of truth:** with this feature in place, `controllerIp` /
`dmxUniverse` / `dmxAddress` / `controllerId` in `patches.yaml` become **generated
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
- `beforeunload` + `sendBeacon` flush already covers this state since it rides
  `configTree`.

---

## UI Design

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
│ │ ▸ Port 1 · U2  ████████████░░░░░░░  41/512   [👁] [🗑]  │ │
│ │     1 ▪Par 1   11 ▪Par 2   21 ▪Par 3   31 ▪Par 4        │ │
│ │     [+ from selection] [+ from list] [+ gap]            │ │
│ │ ▸ Port 2 · U3  ███░░░░░░░░░░░░░░░░  66/512   [👁] [🗑]  │ │
│ │ ▸ Port 3 · U4  (empty)                       [👁] [🗑]  │ │
│ │ ▸ Port 4 · U5  (empty)                       [👁] [🗑]  │ │
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
- **Port row**: collapsible. Header shows universe (click-to-edit number input,
  validated unique), an **occupancy bar** (channels used / 512, turns red on
  overflow), an isolation eye, delete.
- **Chain**: horizontal chips in daisy order, each prefixed with its **computed start
  address**. Chips drag-to-reorder (addresses re-pack live), `✕` on hover to unmap.
  Gap entries render grey with their width, click to edit/remove.
- **Unmapped tray**: every fixture in no chain, filterable by name/group. This list
  going to **zero** is the operator's "fully patched" signal — the `⚠` count in the
  header is the same number.

### The two add flows (the heart of the feature)

**Flow A — pick in 3D, add to port:**
1. With the panel open, multi-select fixtures in the 3D view (existing
   click / shift-click selection — `selectedFixtureIndices`). **Selection order is
   preserved and becomes chain order.**
2. Every port row shows `[+ from selection (n)]` with the live count.
3. Click it → fixtures append to that chain in selection order, addresses pack,
   chips appear, 3D updates (below). Already-mapped fixtures in the selection are
   rejected with a loud toast naming them and their current port — never silently
   skipped, never silently moved.

**Flow B — pick from list, see it in 3D:**
1. Click `[+ from list]` on a port → the Unmapped tray enters *pick mode* for that
   port (port row glows; tray title says "adding to Bow PKnight · Port 1").
2. **Hovering** a tray entry flash-highlights that fixture in 3D (emissive pulse on
   its selection proxy). **Clicking** an entry selects it in 3D (same highlight as a
   manual click) *and* appends it to the chain immediately — one click per fixture,
   in the order you click. `Esc` or clicking elsewhere exits pick mode.

Both flows are append-based and incremental: map four pars, look up at the 3D view,
confirm, continue. No staging area, no apply button, no modes beyond the transient
pick mode.

### 3D feedback (always-on while panel is open)

- **Mapped vs unmapped tint**: unmapped fixtures' selection dots render dimmed/grey;
  mapped ones full-color. The rig visibly "lights up" as you patch — this is the
  single most useful piece of on-site feedback.
- **Port isolation eye** (reuse the Views isolation machinery —
  `window.__activePreviewView` generalizes to an arbitrary fixture predicate, or a
  parallel `__activePortPreview` consumed by the same zero-scaling pass in
  `animate.js`): only that port's chain remains visible.
- **Chain polyline**: while a port row is expanded or isolated, draw a thin line
  through its fixtures in chain order with small numbered sprites (1, 2, 3 …). For a
  daisy chain this is the difference between "looks right" and "is right" — you can
  visually walk the cable path.
- Clicking a chain chip selects that fixture in 3D; clicking a mapped fixture in 3D
  scrolls/flashes its chip in the panel. Bidirectional, instant.

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
lost).

| Rule | Failure surfaced as |
|---|---|
| Universe unique across all ports of all controllers | red chip on both ports, names the collision |
| Chain packing ≤ 512 channels | occupancy bar red, overflowing chips struck through, export blocked |
| Fixture in ≤ 1 chain | structurally impossible via UI; load-time validation throws listing duplicates |
| Controller IPs unique + well-formed | red border + chip |
| Chain references resolve to existing fixtures | load-time: loud console error + panel banner listing orphans (fixture renamed/deleted); orphans render as red chips, one click to drop |
| `controllers.yaml` schema valid | boot throws with file/line context — no partial load |

Load-time validation mirrors the engine's sidecar validation philosophy from PR #11:
a stale `controllers.yaml` must never half-apply.

---

## Relationship to the Auto-Patcher

The auto-patcher (`auto_patcher.js`, spec `.agent/00_gol/10_auto_patcher.md`)
currently invents addresses with no hardware model. It is **reframed, not removed**:

- **"⚡ Auto-fill" on a port**: appends all unmapped fixtures of a chosen group to
  that chain (group picker, spatial sort optional) — the bulk path for "these 20
  strand fixtures all hang off Port 2".
- **Global effects pass** (fog/haze pinned to universe 1, addresses 512↓): becomes a
  default "Effects" port the operator can see and edit, instead of invisible magic.
  `DMX_RESERVED_CHANNELS` ([511, 512]) is enforced as an implicit gap at the top of
  every chain's universe.
- `sectionId` / `fixtureId` assignment is untouched (still group-derived /
  monotonic); `controllerId` now comes from the controller's stable `id`.

The legacy "🎯 Auto-Patch All Unpatched" button is removed once the panel ships — it
writes fields the panel owns.

## Downstream impact

- **Model exporter / marsin_engine / sidecars**: zero change. They read the same
  per-fixture fields the projection writes.
- **sACN output** (`sacn_output_client.js` unicast to `controllerIp`): zero change.
- **Follow-up (tracked, not v1)**: derive `common.yaml → sacn_universes` from the set
  of mapped universes instead of a hand-maintained list — the Logsville universe-7
  mismatch (task 012) is exactly the bug this would delete.

---

## Implementation plan

| Phase | Scope | Files |
|---|---|---|
| 1. Model + persistence | `controller_registry.js` (create/validate/project/pack), `controllers.yaml` load in `main.js`, `configTree.controllers` extraction in `save-server.js`, projection onto configs, unit tests for packing/validation | `simulation/src/dmx/controller_registry.js` (new), `simulation/main.js`, `simulation/server/save-server.js` |
| 2. Panel UI | `controller_map_editor.js` modeled on `view_masks_editor.js`: cards, ports, chains, unmapped tray, drag-reorder, modals, pointer-guard ID | `simulation/src/gui/controller_map_editor.js` (new), `simulation/src/core/interaction.js`, `simulation/src/gui/gui_builder.js` (button) |
| 3. 3D linkage | selection-order capture, pick mode, mapped/unmapped tint, port isolation, chain polyline + numbered sprites | `interaction.js`, `animate.js`, small `chain_overlay.js` (new) |
| 4. Read-only cards + auto-patcher rework | derived patch display on fixture cards, auto-fill per port, effects port, remove legacy button | `gui_builder.js`, `auto_patcher.js` |
| 5. Verification | real-UI puppeteer suite (the Views-panel test methodology: drive actual buttons, never APIs), titanic 61-fixture mapping dry run, round-trip identity check on save→load→save | `~/tmp` scripts, report in `.agent/02_reports/` |

Each phase is independently land-able; phase 1+2 alone already beats today's workflow.

## Open questions (for Sina)

1. **Port count default** — 4 confirmed; is there a hardware max worth enforcing
   (PKnight boxes are 4-out?), or leave unbounded?
2. **Selection order in 3D** — `selectedFixtureIndices` is a `Set` today; preserving
   click order needs an ordered structure. Any reason selection order is relied on
   elsewhere as unordered?
3. **Protocol field** — keep `protocol: sacn|artnet` informational in v1, or should
   the sim's output path actually branch on it?
4. **Universe numbering** — auto-suggest next-free on port add (proposed), or do you
   want a per-controller universe base convention (e.g. controller N owns 10·N…)?
