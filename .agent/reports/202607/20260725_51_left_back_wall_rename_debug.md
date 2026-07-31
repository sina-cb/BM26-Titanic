# "Left Back Wall Generator" still troublesome — diagnosis

Opus debug/investigation session. **Diagnosis only.** Zero writes to
`simulation/scenes/**`, `models/**` or any simulation source; no server started,
stopped or restarted; no live browser opened against the operator's `:6969`; no
git operations. Everything below was reproduced **offline**, against
**read-only copies** of the operator's scene files in `~/tmp/lbw_debug/`,
driving the **real** sim modules (`trace_group_rename.js`,
`generator_chain_order.js`, `view_registry.js`).

---

## 0. TL;DR

- **Symptom.** The trace-card **Name** edit `Left Back Wall Generator` →
  `Left Back Wall` is **refused, loudly, with zero mutations**, showing
  `A group named "Left Back Wall" already exists.` It is the ONLY generator in
  the scene that still refuses. Today he renamed **13 of 14** generators
  successfully; this is the last one wearing a "Generator" suffix, which is why
  it stands out.
- **Root cause is unchanged and is scene DATA, not code:** the **5 orphaned
  fixtures `Left Back Wall 1-5`** (plus 7 more, `Left Center Auditorium 1-7`)
  still sit in `parLights` with `traceGenerated: true` and **no owning trace**.
  `traceRenameError`'s "collision with an existing par group" clause fires on
  them. They have been there since before the earliest scene backup.
- **`_47`'s new code is behaving CORRECTLY.** The refusal happens in the
  pre-existing `_37` collision guard, which runs **first**, before every gate
  `_47` added. Nothing half-applies, nothing is orphaned, the input reverts. The
  13 successful renames today carried their view bits, group overrides and
  fixture names perfectly (`views.yaml` now has **zero** stale keys) — that is
  strong live evidence the rename plumbing is healthy.
- **New, quantified: the orphans are not separate lights.** All 12 are
  **exact-coordinate duplicates of live groups** — `Left Back Wall 1-5` ≙
  `Left Back Wall Generator 5,4,3,1,2` (the index permutation is exactly the
  trace's `chainSplits` order), and `Left Center Auditorium 1-7` is the same
  auditorium run before he bumped it 7 → 8 and renamed it `Left Auditorium`.
  They cost **97 of the 987 pixels (9.8 %) in `models/titanic.js`**, 12 of the
  parity validator's 98 `unmapped_fixture` errors, and they trip the 5-cm
  overlap toast on **every** `rebuildParLights()`.
- **Three traps stand between him and a clean rename** — §4. The worst: the
  group card's **`✕ Delete` button does not delete**, it re-homes the fixtures
  into another group (the orphans would land in `Left Center Auditorium` /
  `Left Back Wall`). And once the rename *succeeds*, the 2D Top-Down view will
  **silently drop the real bars**, because `ORPHAN_GROUPS` hardcodes the string
  `'Left Back Wall'`.
- **Separate live breakage found:** his 16:25→16:38 rename batch has **already**
  gone stale on two hardcoded 2D-default names (`Left Top Chimney Generator`,
  `Left Front Deck Generator`) — 4 red tests, and the **left** chimney ring +
  left front vintage lights are missing from the 2D pixel map right now. Same
  class of bug `_46` fixed for the *right* ring. §6.

---

## 1. Disk truth vs live truth

The operator is mid-session and saving frequently. Two saves landed **during**
this investigation:

| `simulation/scenes/titanic/*` mtime | What changed |
|---|---|
| `16:25:56` | first snapshot I read |
| `16:38:58` | **new save mid-investigation** — +2 fixtures (`TE Sign 2`), and the trace-rename batch below |

Everything in this report was **re-verified against the 16:38:58 save**. Disk
and live are close (he saves every few minutes), but the authoritative statement
is: **as of the `16:38:58` save on disk, the rename has not been applied and the
12 orphans are still present.** Anything he has done in the last minutes without
saving is not visible to me — I deliberately did **not** open a browser against
his `:6969`.

`simulation/.scene_backups/titanic/` gave a full save-by-save history of the
day, which is where the timeline in §2 comes from.

---

## 2. What he actually did today (from the backup timeline)

Trace group names, per save:

| Save | Trace groups |
|---|---|
| `…07-24 11:05` → `07-29 13:25` | all 12 end in `… Generator` |
| `13:25:14` | `Right Top Chimney Generator` → **`Right SmokeStacks`** |
| `13:26:39` | + `Left Small SmokeStack`, `Right Small SmokeStack` (new traces) |
| `15:19:20` | `Left Center Auditorium Generator` → **`Left Auditorium`** (count 7→8), `Right Center Auditorium Generator` → **`Right Auditorium`**, `Left Front Wall Generator` → **`Left Front Wall`**, `Right Front Deck Generator` → **`Right Front Rails`** |
| `16:25:56` | (mapping work; names unchanged) |
| **`16:38:58`** | `Left Back Deck Generator` → **`Left Back Rails`**, `Left Front Deck Generator` → **`Left Front Rails`**, `Left Top Chimney Generator` → **`Left SmokeStack`**, `Right Back Deck Generator` → **`Right Back Rails`**, `Right Back Wall Generator` → **`Right Back Wall`** |

**13 renames, 13 successes, 1 refusal.** The survivor list at `16:38:58` is:

```text
Left Auditorium, Left Back Rails, Left Back Wall Generator, Left Front Rails,
Left Front Wall, Left Small SmokeStack, Left SmokeStack, Right Auditorium,
Right Back Rails, Right Back Wall, Right Front Rails, Right Front Wall,
Right Small SmokeStack, Right SmokeStacks
```

`Left Back Wall Generator` is the **only** name left with the suffix. That is
"still troublesome".

**No new orphans were created by any of those 13 renames** — the orphan census
at `16:38:58` is still exactly the same 12 fixtures (+ the two hand-placed
`TE Sign` / `TE Sign 2` groups, which are `traceGenerated: false` and legitimate).
`views.yaml` `groupBits` has **zero** keys without a live group. `_37` + `_47`
are doing their job.

---

## 3. Root cause, reproduced

`~/tmp/lbw_debug/probe.mjs` loads read-only copies of the operator's
`scene_config.yaml` + `views.yaml` and calls the real modules. Output against
the `16:38:58` save:

```text
trace.name / groupName : "Left Back Wall Generator"   (traces[5], count 5)
group "Left Back Wall Generator" fixtures : 5
group "Left Back Wall"           fixtures : 5

GATE 1 — traceRenameError  → REFUSED: 'A group named "Left Back Wall" already exists.'
   clause: other-trace collision  : false
   clause: existing par-group hit : 5 fixture(s):
        Left Back Wall 1..5   [traceGenerated=true]

GATE 2 — chainSplitsError  → PASS (splits valid; chain order 4,5,3,2,1)

COUNTERFACTUAL (orphans removed):
   traceRenameError        → PASS (rename allowed)
   sweepGeneratedInstances → kept=82 removed=5 (the 5 real generator instances,
                             correctly swept for regeneration under the new name)
```

The firing clause is `simulation/src/gui/trace_group_rename.js:49-53`:

```js
  for (const light of parLights || []) {
    if (light.group && light.group === newName && light.group !== oldGroupName) {
      return `A group named "${newName}" already exists.`;
    }
  }
```

**This is pre-`_47` code** (it came from `_37`). In
`gui_builder.js:4532` it runs as the **first** gate in the trace-name
`onFinishChange`, ahead of the `chainSplitsError` gate (`_47` step 8), the
mapping invalidation (step 9) and every mutation. So on refusal:
`trace.name` is reverted to the committed name, `trace.groupName` is untouched,
no override/view-bit/patch-tree/mapping is touched, and `debounceAutoSave()` is
never reached. **The behaviour is correct.** The message is just uninformative:
it does not say the colliding group is an ownerless orphan.

### The orphans are duplicates, not lights

| Orphan | world (x, y, z) | Identical live fixture |
|---|---|---|
| `Left Back Wall 1` | −26.9816, 3.1867, 1.1102 | `Left Back Wall Generator 5` |
| `Left Back Wall 2` | −23.9553, 4.8779, 1.1189 | `Left Back Wall Generator 4` |
| `Left Back Wall 3` | −20.9291, 6.5691, 1.1276 | `Left Back Wall Generator 3` |
| `Left Back Wall 4` | −17.9028, 8.2602, 1.1364 | `Left Back Wall Generator 1` |
| `Left Back Wall 5` | −14.8765, 9.9514, 1.1451 | `Left Back Wall Generator 2` |

Not merely co-located — **bit-identical** on position, rotation, `fixtureType`
(`ShehdsBar`), `color` (`#001eff`), `intensity` (18) and `angle` (30). The index
permutation `1→4, 2→5, 3→3, 4→2, 5→1` is *exactly* the trace's
`chainSplits` expansion `4,5,3,2,1`: the orphans are the **same run numbered
geometrically** (pre-chain-order), the live set is the same run numbered in
chain order.

`Left Center Auditorium 1-7` is the same story: identical line endpoints
(z 3.961 → 13.406 at x ≈ −13.34, y 12.5) and identical `UkingPar` type as
`Left Auditorium`, just spaced for 7 lights instead of 8 — a snapshot from
before he bumped that generator 7 → 8 at `15:19` and renamed it.

Backup evidence for how they got there: at `07-24 19:42` the scene had
**`Left Back Wall` and `Left Center Auditorium` already orphaned**; three
minutes later, at `19:45`, `Left Back Wall Generator` (5) and
`Left Center Auditorium Generator` (7) appear. He re-created the generators with
a ` Generator` suffix **because the plain names were already taken by the
orphans** — and today's cleanup is him trying to take the plain names back.

### What the orphans cost, measured

| Surface | Cost |
|---|---|
| `marsin_engine/models/titanic.js` | **97 of 987 pixels (9.8 %)** — `Left Back Wall` 90 px + `Left Center Auditorium` 7 px, sitting at model indices `i: 0…96`, i.e. the **first** two sections |
| `patches.yaml` | 12 records holding `sectionId` 1 + 2 and `fixtureId` 1-12 |
| `scene_model_parity.cjs titanic` | 12 of the 98 `address_hygiene/unmapped_fixture` errors — phantoms inflating the Phase-B mapping countdown |
| `views.yaml` | 2 of 26 view-mask bits (`Left Back Wall: 524288`, `Left Center Auditorium: 262144`) |
| Sim UI | 5-cm overlap detector (`fixtures.js:161`) matches **exactly**, so the `⚠️ 5+ fixture overlap(s) detected` toast fires on **every** `rebuildParLights()` — every regenerate, add, remove and group render while he maps |
| Controllers panel | the Unmapped tray lists **10** Left-Back-Wall entries for **5** physical bars — an easy way to patch a real controller onto phantoms and see nothing light up |

---

## 4. Three traps on the way to the rename

**Trap 1 — the group card's `✕ Delete` button does not delete.**
`gui_builder.js:2173-2185`:

```js
        delBtn.onclick = () => {
          if (groupOrder.length <= 1) return;
          pushUndo();
          params.parLights.forEach((c) => {
            if (c.group === groupName) c.group = groupOrder.find(g => g !== groupName) || 'Default';
          });
```

It **re-homes** the fixtures into the first other group in appearance order, with
no confirm dialog. Computed against the live scene:

- `✕ Delete` on `Left Back Wall` → the 5 orphans land in **`Left Center Auditorium`**
- `✕ Delete` on `Left Center Auditorium` → the 7 orphans land in **`Left Back Wall`**

So pressing it on both, in either order, silently merges all 12 phantoms into one
real-looking group — and it *would* clear the rename collision, which makes it
look like it worked. **Do not use it here.** The control that actually deletes is
the per-fixture **`✕ Remove`** on each fixture card (`gui_builder.js:2544-2561`,
`params.parLights.splice`, undo pushed, mapping entry dropped).

**Trap 2 — deleting then renaming without a reconcile shuffles the view bit.**
`view_registry.renameGroup` takes its **merge** branch when the target key
already exists, and `views.yaml` still holds `Left Back Wall: 524288` from the
orphans. Probe output:

```text
before: "Left Back Wall Generator"=16   "Left Back Wall"=524288
after renameGroup: "Left Back Wall Generator"=undefined   "Left Back Wall"=524288
   ^ MERGE branch — old bit 16 FREED, group inherits the ORPHAN's bit
```

Harmless **today** (every `viewMask` in `patches.yaml` is `0`, and `custom: []`),
but it is a silent bit change. Doing a **save/model-export between the delete and
the rename** avoids it: the exporter calls `reconcileGroupBits`, which drops the
now-dead `Left Back Wall` key, and the rename then carries bit **16** cleanly
(verified in the probe).

**Trap 3 — the rename will make the real bars vanish from the 2D Top-Down view.**
`simulation/src/gui/pixel_map/pixel_map_view_defaults.js:94`:

```js
export const ORPHAN_GROUPS = ['Left Back Wall', 'Left Center Auditorium'];
```

…fed into the Top-Down panel's `exclude` (line 148). It is keyed on the **string**,
not on orphan-ness. The moment the rename succeeds, the **real** 5 bars / 90 px
inherit that name and get excluded — the Left Back Wall row disappears from the
2D pixel map. **This is a code defect that will bite immediately after the
rename succeeds.** I did **not** fix it (diagnosis-only brief; the fix depends on
which path the operator chooses — drop the entry after the delete, or derive
orphan-ness live).

**Related, and worth knowing:** the tripwire test meant to catch exactly this is
**dead**. `simulation/tests/pixel_map_view_defaults.test.js:200` reads

```js
  const traced = new Set((scene.parLights.traces || []).map((t) => t.name));
```

but traces live at `scene.traces`, not `scene.parLights.traces` — so `traced` is
always empty and the assertion `!traced.has(g)` ("`'<g>'` now has a generator
trace — it is no longer an orphan") can **never** fire. The sibling assertion
(`counts === [5, 7]`) *does* work and **will** go red the moment he deletes the
orphans, which is the intended signal. One-line fix
(`scene.parLights.traces` → `scene.traces`, and `t.name` → `t.groupName || t.name`);
**left unfixed here on purpose** — it is not the cause of his symptom, and
changing test semantics mid-session risks surprising the `_50` agent. Filed as a
follow-up.

---

## 5. The minimal path to "Left Back Wall"

**Nothing agents may do unilaterally.** The blocker is 12 fixtures of his own
scene data in a live, unsaved, hardware-attached session, and the codex forbids
silent deletion of operator data.

### Option A — delete the orphans (recommended; the cleanest end state)

**HE does, in his own tab:**

1. Lighting Controls → the **`Left Back Wall`** group (the one with **no**
   generator card behind it) → expand each of its 5 fixture cards → press
   **`✕ Remove`** on each. **Not** the group's `✕ Delete` button (Trap 1).
2. Same for the **`Left Center Auditorium`** group's 7 fixtures — optional for
   the rename, but it is the other half of the same phantom set and it also
   frees `sectionId 1`.
3. **Save** (and re-export the model). This runs `reconcileGroupBits`, which
   retires the dead `Left Back Wall` / `Left Center Auditorium` view bits —
   avoiding Trap 2 — and drops their 12 `patches.yaml` records.
4. Generators → **`Left Back Wall Generator`** card → **Name** → type
   `Left Back Wall` → blur. It will now pass. Expect the normal `_47` report: 5
   fixtures renamed `Left Back Wall 1-5`, the group override + view bit carried,
   and — since nothing on this generator is mapped today — the one-line
   "nothing was mapped under the old name" notice rather than an invalidation list.

Metadata safety, verified: `auto_patcher.assignMetadata` only fills
`sectionId` / `fixtureId` when they are `0`/missing, so deleting the orphans
frees ids 1-12 and **does not renumber** any surviving fixture.

**AGENTS then do (needs his go-ahead, it is simulation source):**

5. Drop `'Left Back Wall'` (and `'Left Center Auditorium'`) from `ORPHAN_GROUPS`
   in `pixel_map_view_defaults.js` — **required**, or the renamed real bars
   vanish from Top-Down (Trap 3). Plus the dead-tripwire fix in
   `pixel_map_view_defaults.test.js`.

### Option B — park the orphans instead of deleting (non-destructive, reversible)

Use the **`✏ Rename`** button on the orphan `Left Back Wall` group (it is a
plain par-group rename, `gui_builder.js:2085`) to move it to e.g.
`ZZ Orphan Left Back Wall`. That clears the collision without destroying
anything, and the generator rename then passes. **But** it keeps all 97 phantom
pixels, the 12 phantom unmapped-fixture errors and the overlap toast, and it
still needs the Trap-2 save-between and Trap-3 `ORPHAN_GROUPS` follow-up. Useful
only if he is not yet sure the orphans are junk.

### Option C — leave it named "Left Back Wall Generator"

Zero risk, zero work. The refusal is correct behaviour; the name is cosmetic.

**What he must decide:** A, B or C — i.e. *are the 12 orphans junk?* The
evidence in §3 says yes, unambiguously: bit-identical duplicates of two live
generator runs, with a backup trail showing how they were left behind. But they
are his scene data and only he can authorise the delete.

---

## 6. Separate finding — his 16:38 rename batch just broke the 2D defaults again

`node --test tests/pixel_map_view_defaults.test.js` → **4 failures**, all of the
form *"group '…' has no fixtures / no longer exists in the titanic scene"*.
Cross-checking every hardcoded group name in `pixel_map_view_defaults.js`
against the `16:38:58` scene:

| Constant | Hardcoded name | Live? |
|---|---|---|
| `CHIMNEY_GROUPS` | `Left Top Chimney Generator` | **STALE** → he renamed it `Left SmokeStack` |
| `CHIMNEY_GROUPS` | `Right SmokeStacks` | ok |
| `FRONT_VINTAGE_GROUPS` | `Left Front Deck Generator` | **STALE** → he renamed it `Left Front Rails` |
| `FRONT_VINTAGE_GROUPS` | `Right Front Rails` | ok |
| everything else (`FRONT_BAR_GROUPS`, `FRONT_STRAND_GROUPS`, `SMALL_SMOKESTACK_GROUPS`, `ORPHAN_GROUPS`) | — | ok |

Consequence right now, in his live 2D pixel map: the **left** chimney par ring
and the **left** front vintage lights resolve to **0 clusters** and are missing
from the Top-Down / Front views. This is the identical failure `_46` repaired for
the *right* ring after his earlier `Right Top Chimney Generator` rename — the
selectors are pinned by literal name, so every operator rename re-breaks them.

Two fixes, one tactical and one structural:

- **Tactical (agents, small, needs his ok):** re-point the two stale constants at
  `Left SmokeStack` and `Left Front Rails`.
- **Structural (his call, already on the table as `_44` §5 Q2):** derive the 2D
  default views from **live groups** instead of hardcoded names. Three separate
  reports (`_46`, `_48`, this one) have now had to chase the same class of
  breakage. As long as he keeps renaming groups, this will keep recurring.

Note this failure mode is *silent to a rename*: the trace rename only re-points
`{group: …}` selectors in **saved custom pixel-map views** (`_47` step 12) — the
hardcoded **defaults** are source constants and no rename can reach them.

---

## 7. Verification / what I ran

- `~/tmp/lbw_debug/probe.mjs` — offline, read-only, imports the real
  `trace_group_rename.js`, `generator_chain_order.js`, `view_registry.js`; run
  against copies of both the `16:25:56` and `16:38:58` saves. Same verdict.
- `node --test tests/trace_group_rename.test.js tests/rename_invalidation.test.js
  tests/rename_hygiene_wiring.test.js tests/pixel_map_view_defaults.test.js`
  → **71 pass / 4 fail**. All 4 failures are in `pixel_map_view_defaults.test.js`
  and are §6's stale hardcoded names — i.e. **caused by the operator's 16:38
  renames, not by any code change**. Every rename-hygiene and
  `trace_group_rename` test is **green**.
- `node tools/scene_model_parity.cjs titanic` (from `simulation/`) →
  `FAIL — 98 error(s), 0 warning(s), 9 info`; 12 of the 98 are the orphans.
- Python census of `scene_config.yaml`, `views.yaml`, `patches.yaml`,
  `models/titanic.js`, and every save in `simulation/.scene_backups/titanic/`.
- **No browser was opened**, no page loaded against `:6969`, no screenshot taken.
  Deliberate: `animate.js:679` enables the sACN output client on any non-readonly
  sim client, and he has real hardware attached.

### Zero-write proof

`simulation/scenes/**` and `marsin_engine/models/**` were only ever **read**.
The only files written this session are `~/tmp/lbw_debug/*` (copies + probe) and
this report + the master-doc row. Servers untouched; `netstat` shows the same
single stack on `6967-6972` as at session start.

---

## 8. Follow-ups filed

1. **`ORPHAN_GROUPS` must lose `'Left Back Wall'` the moment the rename lands**
   — otherwise the real bars vanish from Top-Down. **Two places** hold the
   literal: `simulation/src/gui/pixel_map/pixel_map_view_defaults.js:94` and a
   duplicated copy in `simulation/agent_tools/pixel_map_view_tuning_verify.cjs:43`.
   Blocking on the operator's A/B/C decision.
2. **Dead tripwire** in `pixel_map_view_defaults.test.js:200` —
   `scene.parLights.traces` should be `scene.traces` (and `t.name` →
   `t.groupName || t.name`). One line; currently vacuous.
3. **`✕ Delete` on a par group is mislabelled** — it re-homes, it does not
   delete, and it has no confirm. Either rename it (`↪ Dissolve into <group>`)
   or give it a confirm naming the destination group.
4. **Stale 2D-default constants** (§6) — re-point `Left Top Chimney Generator` →
   `Left SmokeStack` and `Left Front Deck Generator` → `Left Front Rails`, and
   revisit live-derived defaults (`_44` §5 Q2).
5. **Make the collision refusal explain itself** — when the colliding group has
   no owning trace, say so: *"'Left Back Wall' is held by 5 orphaned fixtures
   with no generator — delete or rename them first."* One clause in
   `traceRenameError`, and it would have saved this whole round trip.
