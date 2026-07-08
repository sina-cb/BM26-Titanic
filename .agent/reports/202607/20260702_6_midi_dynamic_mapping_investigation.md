# MIDI dynamic-mapping investigation — current state, gaps, and a proposal

**Date:** 2026-07-02 · **Author:** Fable (read-only investigation)
**Branch:** `feat/captainpad-midi-control`, tip `1e878d77` (post-Wave-2, pre-bench)
**Inputs:** docs/34, reports `20260702_2/3/4/5`, and the code itself (every claim below
carries file:line from this tip).

**Question:** the mapping stack has both static YAML profiles and dynamic behaviors
(MIDI-learn, focused-channel ordered knobs). Where would MORE dynamic mapping genuinely
help the operator on the playa — and where would it violate the 8-principle ideology?

---

## 1. Current-state map

The seam discipline holds everywhere I looked: **mapping lives entirely in CaptainPad**
(`utils/midi/*` + the hook), the **engine's control path is untouched** (every dispatch
lands on a pre-existing `utils/api.ts` route — `dispatch.ts:55-100`), and the ONLY engine
additions are **persistence-only** (`midiMappings` CRUD, `api_server.js:3454-3553`,
explicitly "PURE METADATA — the render loop never applies them", `midi_mapping_engine.js:8-12`).
Every proposal below respects that split.

### 1a. STATIC mechanisms (data fixed at build time)

| Mechanism | Where | How far it goes | Limitation |
|---|---|---|---|
| Device profiles (YAML) | `midi_profiles/apc_mini_mk2.yaml`, `mft.yaml`; types + validator `utils/midi/profile.ts:114-395` | Full declarative control→action map; validated fail-loud at load (`profile.ts:325-368`); overlapping matches rejected (`profile.ts:388-391`) | Profiles are **static Metro imports** (`useMidiControl.ts:64-65`, `loadProfiles()` `:428-442`). Changing ANY mapping = edit YAML + reload the JS bundle. No runtime add/edit/select. |
| Fixed APC fader roles | `apc_mini_mk2.yaml:32-50` — faders 1-3 → channel faders, 7 → global speed, 9 → master | — | Hardcoded; faders 4-6 + 8 deliberately left out of the profile as the learn pool (`:41-44`) |
| Fixed APC track buttons → focus 1-3 | `apc_mini_mk2.yaml:60-71` (`focusChannel` layers 0-2) | LED lit = focused, blink = pickup-locked | Only 3 layers; assignment fixed |
| Fixed pad grid split | cols 1-4 playlist browser `apc_mini_mk2.yaml:79-126`; cols 5-8 palette pairs `:133-144` | Browser window content IS dynamic (playlist-ordered) | The 4/4 column allocation itself is fixed |
| Fixed scene column | blackout note 119 + GE slots 1-7 `apc_mini_mk2.yaml:147-178` | Slot state dynamic | Which slot on which button is fixed (deliberately — muscle memory) |
| MFT bank-2 global knobs | `mft.yaml:144-152` — knobs 1-3 hardcoded to `speed`/`size`/`rotate`; **knobs 4-16 (CC 19-31) reserved/unmapped** (`:153-154`) | Relative + ring feedback + sync gate all work | Adding a key = YAML edit + bundle reload; docs/34:745 says "add keys to `mft.yaml` as Sina picks them" |
| Action-kind vocabulary | `profile.ts:133-139` (`ACTION_KINDS`, 18 kinds) | Covers every current gesture | New verbs (momentary/punch) need code, by design |
| Per-tab contexts | `profile.ts:118-123` (`contexts` map), `resolver.ts:117` (context select), `manager.ts:529-534` (`setContext`), `useMidiControl.ts:390-397` (`setMidiActiveContext`), published by tabs at `index.tsx:178` / `mixer.tsx:756` | Machinery fully built and tested (`context.test.ts:22-38`) | **Deliberately vestigial**: `apc_mini_mk2.yaml:28/:180` aliases deck and mixer to ONE list (`&unified`/`*unified`); mft.yaml is context-free. The per-tab layouts were collapsed after two bench iterations (docs/34 §"unified layout"). |

> **Docs/code mismatch #1:** the task brief (and older notes) reference
> `utils/midi/context.ts` — **no such file exists**. Context is a mechanism spread
> across `profile.ts`/`resolver.ts`/`manager.ts`/`useMidiControl.ts`; only
> `context.test.ts` carries the name.

### 1b. DYNAMIC mechanisms (bindings built/changed at runtime)

| Mechanism | Where | How far it goes | Where it stops |
|---|---|---|---|
| **MIDI-learn** (per-param binding) | Arm/capture: `learn.ts:80-131`; runtime capture + conflict rejection: `manager.ts:560-574` via `profileClaims` (`resolver.ts:217-229`); popover UI: `MidiMap.tsx:138-320`; save-time re-check: `useMidiControl.ts:291-297` | Bind any unclaimed CC/note to a **pattern-local param** of the focused channel; range scale/invert; enable/disable; soft-takeover pickup (`learn.ts:143-177`); binding-first over profile (`manager.ts:580-584`) | **Scope is `pattern` only** — `midi_mapping_engine.js:19` (`VALID_TARGET_SCOPES = ['pattern']`). Cannot learn onto a CPC global, GE slot, section brightness, master, or playlist action. Absolute CC + note only (see the relative-CC footgun, §2). |
| Learn persistence | Engine: `PUT/PATCH/DELETE /api/playlists/:name/items/:itemId/midi-mappings/:id` `api_server.js:3462-3553`; upsert-by-target `playlist_manager.js:403-414`; validation `midi_mapping_engine.js:31-74`; `playlistSaved` broadcast → multi-client sync | Bindings ride the playlist entry — per-pattern-instance, survives restarts, syncs to every iPad | Per-ENTRY storage is right for pattern params but structurally can't hold a global binding |
| **Focused channel** (one focus, all deep surfaces) | `FocusedChannel` `manager.ts:147-171`; single intent writer `setFocusIntent` `manager.ts:643-649` + derived reader `effectiveFocusLayer` `:819-827`; hook builds the snapshot `useMidiControl.ts:509-598`; sources: APC track buttons, touch (`setMidiFocus` `:219-227`), MFT side buttons (`mft.yaml:164-172`) | Post-Wave-1 this is genuinely one source of truth (touch + MIDI agree) | Focus targets layers 0-2 only (profile-fixed) |
| **Ordered knob auto-map** (MFT bank 1) | ONE derivation `deriveKnobOrder` (`knob_order.ts:83-101`): kind===1, not cpcOwned, numeric v0 → knob i drives `knobMapped[i]`; feeds BOTH the runtime (`useMidiControl.ts:558`) and the on-screen "KNOB N" badges (`knob_badge.ts:36-48`); delta applied to modulation base at flush (`manager.ts:709-735`); ring shows `base ?? v0` (`manager.ts:996-1000`) | The headline dynamic behavior: knobs re-map themselves to whatever pattern is focused, zero setup, screen order provably ≡ knob order | Order is **declaration order only** — no importance ranking, no per-pattern pinning; a pattern's 17th+ slider is unreachable; the operator can't put a favorite param on a specific knob |
| Encoder-push reset | `manager.ts:655-685` — resets to the entry's saved default (`defaults` threaded at `useMidiControl.ts:570-573`) | Per-entry data drives it | No default saved → documented no-op |
| Playlist window browser | cursor state `manager.ts:299,944-965`; content playlist-ordered | Pads track live playlist content | Column allocation static |
| MFT bank switching | hardware-local; tracked via `decodeBankChange` `manager.ts:544-553` | Banks 1-2 live | Banks 3-4 dark (reserved) |
| LED/ring feedback | `led_projector.ts` diffed projection off the engine snapshot | Fully dynamic, engine-as-truth | — |
| Activity auto-disable | `useMidiControl.ts:349-374` (autopilot/transitions off on MIDI activity, restore after 60 s) | — | — |

> **Docs/code mismatch #2 (latent footgun, worth a card):** MIDI-learn will happily
> capture an **undeclared relative encoder**. `controlRefFromEvent` (`learn.ts:33-43`)
> treats every CC as absolute-continuous. MFT bank-1 turns (ch0 CC0-15) are
> profile-claimed so learn rejects them — but **MFT bank-3/4 turns (ch0 CC 32-63) are
> unmapped and learnable**, and a learned one would feed the delta codes 61-67 through
> `scaleMidiToRange` as absolute values, pinning the bound param to ~0.48-0.53 jitter.
> Nothing in docs/34 warns about this. Cheap guard: reject capture when the CC value
> decodes as a relative code, or name-gate learn away from a `configureOnConnect`
> device's rotary channel.

---

## 2. Gap analysis — static-and-painful vs already-dynamic, ranked by playa pain

**Already dynamic and GOOD (don't touch):** learn-per-param, focused-channel, ordered
knobs, playlist-window pads, LED projection. These cover the nightly workflow: select
entry → focus → sculpt 16 params → punch effects → blackout.

Ranked operator pain from what remains static:

| # | Pain | Evidence | Why it hurts at 2 a.m. |
|---|---|---|---|
| **G1** | **MFT bank-2 knobs 4-16 are dead until someone edits YAML** | `mft.yaml:153-154`; open question in docs/34:804 and report 2 | This is the one mapping Sina is *expected to iterate on* ("add keys when you pick them") — and the iteration loop is edit-YAML → rebuild bundle → reload. On playa that's a laptop + Metro, exactly what the mission avoids. |
| **G2** | **Knob order is declaration order, take it or leave it** | `knob_order.ts:83-101`; no override input | A pattern whose most-played param is declared 9th puts it on the MFT's third row forever. Muscle memory wants "my top 4 params on the top row" per pattern. >16 sliders → silently unreachable knobs. |
| **G3** | **Learn can't target anything global** | `midi_mapping_engine.js:19`; `applyBinding` only resolves against `focused.exports` (`manager.ts:867`) | The APC has spare real estate (fader 4-6/8 when unlearned, Shift, unused pads); none of it can be given to a CPC param, GE slot, or section brightness without a YAML edit + reload. |
| **G4** | Relative-CC learn footgun (mismatch #2 above) | `learn.ts:33-43` | Not a daily pain, but a silent-garbage failure mode — codex P0 material. |
| **G5** | Remapping any static control (blackout, speed fader, focus buttons) needs YAML | `useMidiControl.ts:64-65` | Ranked LOW deliberately — see ideology check: most of this *should* stay frozen. |
| **G6** | One profile per device, no variants/presets | `loadProfiles()` `useMidiControl.ts:428-442` | Low: there is one operator corps and one rig; variants mostly add a "which map am I on?" failure state. |

---

## 3. Dynamic-mapping proposal

### Ideology cross-check first (docs/34 §"control ideology")

Reinforced by more dynamism, per principle:
- **P3 engine-as-truth / stateless controllers** — any new binding must live engine-side
  (or per-entry) and be projected back; the `midiMappings` persistence-only precedent
  (amended non-goal, docs/34:239-241) is the template.
- **P5 mapping-is-data** — runtime bindings ARE data; the static profile stays the
  reviewed, git-versioned skeleton.
- **P6 fail-loud** — capture-time conflict rejection (`manager.ts:560-574`) already
  generalizes to any new learnable target.

**Violated by** (explicitly do-NOT-build):
1. **A free-for-all in-app remapper of the static layout** (blackout, master, speed,
   focus buttons, scene column). Violates **P7 muscle memory is sacred** ("blackout
   lives in the same corner forever"; "a learned binding may not shadow a global
   control — enforced at capture time", docs/34:71-74) and P5 (the safety layout should
   be code-reviewed in git, not mutated at FoH). The existing conflict-rejection is the
   ideology working as intended — keep it.
2. **Per-operator hot-swappable profile presets.** Violates P7 (volunteers learn ONE
   surface) and adds a stateful "which preset is live?" failure mode (P3/P6). If
   variants are ever wanted, they belong in git as YAML, selected at boot, fail-loud.
3. **Expanding per-tab context mappings.** The machinery exists (`profile.ts:118-123`)
   and the team *already walked back* per-tab layouts to the unified `&unified` anchor
   after bench iterations. Re-diverging tabs reverses a bench-validated decision. Keep
   contexts as the target-switching mechanism it is today, nothing more.
4. **Controller-side macros (one knob → N params) / morph scenes.** A macro has no
   single engine value to project onto its ring/LED → the controller (or CaptainPad)
   would hold authoritative virtual state, violating P3, and a hot-unplug would lose
   it. Macros are legitimate — **as an engine feature** (an engine-side macro param the
   knob writes like any other), which is a separate deliberate engine design, not a
   mapping-layer hack. Defer; do not build in `utils/midi`.

### The proposal, prioritized

**M1 — Assignable MFT bank-2 knobs (in-app "assign global param to knob N")** · closes G1
- **What:** a small picker (natural home: the MIDI tab, `app/(tabs)/midi.tsx`, or the
  Config MIDI section) listing knobs 4-16 and the engine's [0,1]-normalised CPC keys
  (from the live `paramSchema`, already in the hook at `useMidiControl.ts:627`);
  assignment creates a runtime `paramCenterRelative` binding — same shape the profile
  produces, same flush path (`manager.ts:736-761`), same sync gate + validation
  (`profile.ts:413-439` already validates `paramCenterRelative` keys).
- **Why:** the only mapping with a designed-in iteration loop currently requires a
  laptop. Muscle-memory-safe by construction: those knobs are dead today, so there is
  no old hand to move (P7 clean).
- **Shape:** CaptainPad — a runtime binding table consulted next to the profile in
  `onMessage`/resolution (mirror of how learned bindings are binding-first,
  `manager.ts:580-584`), or (simpler) merged into the snapshot. Engine — a small
  **persistence-only** store + route pair (e.g. `GET/PUT /api/midi/global-assignments`
  into a state yaml, broadcast on change), cloned from the `midi-mappings` route
  pattern (`api_server.js:3462-3553`). Zero render-loop involvement.
- **Risk:** low-medium (one new persistence-only engine surface — needs Sina's ack,
  same class of amendment as the midiMappings routes). **Hardware:** buildable +
  unit-testable with FakeTransport; feel-verified on the in-hand MFT (Ring 1).

**M2 — Per-entry knob pinning/reorder** · closes G2
- **What:** an optional `knobOrder: [paramName, …]` list on the playlist entry
  (alongside `midiMappings`/`defaults`); `deriveKnobOrder` gains an override argument —
  pinned names first (in order), remaining learnables in declaration order. Because the
  screens' KNOB N badges and the runtime consume the SAME derivation
  (`knob_order.ts:1-13`), the UI relabels itself automatically. Light UI: a "pin to top"
  affordance on the param row or in the ⊞ popover.
- **Why:** turns the auto-map from "take declaration order" into "my top row is my top
  params", per pattern, saved with the set — exactly the muscle-memory-building move for
  a 16-knob surface. Also the only fix for >16-slider patterns.
- **Shape:** engine — extend the entry validator (lenient-load/strict-save in
  `playlist_manager.js:147/191-210`) with the optional list; CaptainPad —
  `knob_order.ts` + hook (`useMidiControl.ts:558`) + a small UI touch. All existing
  seams.
- **Risk:** low. **Hardware:** none to build; MFT to feel-check.

**M3 — Learn onto GLOBAL targets** (scope `'global'`) · closes G3
- **What:** extend the binding shape with `target.scope: 'global'` → dispatch
  `updateParamCenter` (and optionally `globalEffectSlot`/`sectionBrightness` kinds)
  instead of `setDeck/MixerChannelControl`. Engine validator is a one-line set extension
  (`midi_mapping_engine.js:19`) — but storage moves to the same global store as M1
  (per-entry storage is wrong for globals).
- **Why:** gives the spare APC surface (an unlearned fader, free pads) to whatever
  global the operator actually reaches for, without YAML. Conflict rejection already
  protects the static layout.
- **Risk:** medium — it's the first learn target that ISN'T focus-scoped, so the UI must
  make "this fader is global, not per-pattern" unmistakable (violet vs a new accent),
  or it becomes a muscle-memory trap. This is why it's M3, not M1.
- **Hardware:** APC in hand covers it.

**M4 — Relative-CC learn guard** · closes G4 (do this regardless)
- Reject capture in `controlRefFromEvent`/`manager.ts:562` when the CC value decodes as
  a relative delta code (`decodeRelativeDelta` non-null) — fail-loud message "that's an
  endless encoder — knobs map by order, not by learn". A few lines + tests.

**M5 — (already committed direction, listed for completeness):** momentary/while-held
action kinds for the VSN1 punch surface (docs/34:854-866) and the **#13 driver-seam
registry** (report 4, deferred). Both are prerequisites for driver #3, not
dynamic-mapping features; M1-M4 neither block nor are blocked by them.

---

## 4. Recommendation

**Phasing (after the pending bench pass — report 5's checklist is still UNVERIFIED on
hardware; don't stack new mapping features on unbenched waves):**

1. **First:** M4 (guard, tiny) + **M1** (bank-2 assignment) — highest operator value,
   zero muscle-memory risk, exercises the new global-store seam at its smallest.
2. **Next:** **M2** (knob pinning) — pure data + one pure function + light UI; bench the
   feel of pin-vs-declaration order with the MFT.
3. **Later / after Sina's call:** **M3** (global learn) — reuses M1's store; needs the
   UI-clarity decision first.
4. **Independent track:** momentary kinds + #13 driver seam ahead of VSN1 arrival.

**Bench-blocked vs buildable now:** ALL of M1-M4 are buildable and unit-testable with
zero hardware (FakeTransport harness) and fully verifiable on the in-hand **APC mini +
MFT** via Ring 1 (Chrome Web MIDI). **Nothing here waits on the VSN1**; the VSN1 only
gates its own Phase-0 capture + `grid_vsn1` profile, and its jog/keys will slot into
whatever M1/M3 build (a jog is just another relative control; its keys another learn
pool) — one more reason to land the global-store seam first.

**Open questions for Sina (answers change the design):**
1. **Bank-2 assignment (M1): in-app or YAML-once?** If you'd realistically pick the
   knob-4-16 globals once and never touch them again, a YAML commit is simpler and
   git-reviewed — M1 drops to low priority. If you expect to iterate at the bench/playa,
   M1 is the top item. Which is it?
2. **Global persistence home (M1/M3):** OK to add a second persistence-only engine
   store + route pair (mirroring the midiMappings precedent) for global MIDI
   assignments? It's the engine-as-truth answer (multi-iPad sync, survives restarts) but
   it IS new engine surface — your ack needed, same as D-1 was.
3. **Knob pinning (M2):** is declaration order + the KNOB N badges good enough in
   practice, or do you want "pin my top params to the top row" per pattern? (Bench the
   current behavior first — this one is a feel call.)
4. **Global learn (M3):** would you actually give spare APC controls to globals, given
   fader 7 = speed and MFT bank 2 exists? If no realistic use, we skip M3 and its UI
   complexity entirely.

**Explicitly not building** (ideology violations, §3): static-layout remapper,
per-operator profile presets, per-tab context divergence, controller-side macros
(macros go engine-side or not at all).
