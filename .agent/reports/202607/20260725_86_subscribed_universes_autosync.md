# 20260725_86 — 📡 Subscribed Universes: auto-sync on save (Yes / No / Cancel)

Closes the operator's standing complaint that the `📡 Subscribed Universes`
field is a landmine: a field that has fallen behind the mapping means **dark
fixtures with zero errors**. Sim-side only. No browser session, no scene save,
no device HTTP, no restart, no git ops.

---

## 1. Where the field lives, and why a stale one is silent

| Layer | Fact |
|---|---|
| GUI control | `simulation/src/gui/gui_builder.js:1537` — `addControl(sacnFolder, 'sacn_universes', …)` inside 🔌 Engine → 📡 sACN Settings. The label the operator sees comes from the scene config, not the code default. |
| Persisted home | `simulation/scenes/common.yaml` → `colorWave.sacn_universes` (`{value, label: 📡 Subscribed Universes}`). **common.yaml is operator-owned.** |
| Write path | `params.sacn_universes` → `reconstructYAML()` → `configTree.colorWave.sacn_universes.value` → `POST /save` → `server/save-server.js:322-336` splits `colorWave` into the `commonKeys` bucket and writes `scenes/common.yaml`. **No new code writes that file** — the update rides the existing save-server path the 💾 buttons already use. |
| Consumer | `simulation/server/sacn_bridge.js:88-96` — at BOOT the bridge takes this string as its `Receiver` accept-list, overriding the all-scenes patches scan. |
| Why silence | The `sacn` package filters inbound packets against `receiver.universes` and **drops non-members with no event at all**. Route "created", monitor green, disk fresh, fixtures dark (report `20260725_58` §7.1 layer 6; `20260725_60`). |

Report `20260725_60` (S3) added runtime `addUniverse` on route recompute, but
that path only **extends** an already-running receiver and is inert until the
operator restarts the bridge. **The boot list is still this field.** This slice
fixes it at the source.

Second sharp edge found while writing this: the bridge parses the field with
`split(',') → parseInt`. It has **no range syntax** — a hand-typed `1-24`
subscribes to U1 and U1 only, and the other 23 universes go dark silently. The
new parser reproduces that arithmetic exactly and reports every token it had to
reinterpret.

## 2. What the required set is built from

`computeRequiredUniverses()` is a **union of the projections the Controller
Mapping panel already computes** — not a new scanner:

| Source | Helper | What it catches |
|---|---|---|
| DMX fixture claims (incl. pinned global effects) | `computeProjection().universeMaps` | every universe a patched DMX chain occupies |
| LED strand claims **incl. spill segments** | `computeLedUniverseClaims()` (bound `computeLedStrandPatches` + generic `computeLedProjection`) | a 200 px RGBW run starting on U26 also needs U28 |
| Declared port rows (DMX **and** LED per-output) | read off `registry.controllers[].ports[]` | a port that declares a universe with **nothing patched on it yet** — invisible to every claim map |
| **Parked outputs** | `registry.controllers[].parkedOutputs[]` (report `20260725_71`) | the board is enabled there; cheap headroom, included on purpose |
| Stored patch records | `params.parLights` + `params.dmxFixtures` + `params.ledStrands[].segments` | `patches.yaml` as the bridge's own boot scan sees it — the only source that still speaks when the registry is inactive |

Each universe carries the **reasons** it is needed, so the dialog can name the
controller behind every addition (`U27 — LeftLeftRopes port 2 → output 2`).

**Engine-scene pairs** are not separately enumerable from the sim GUI: the
engine streams the universes this same registry/patches set projects, so they
are already covered by the sources above. Not claimed as a distinct source.

Universes outside the E1.31 window (1…63999) are never admitted.

## 3. Dialog contract

Fires from **`exportConfig()`**, at the very top — **before `saveModelJS()`**, so
`Cancel` genuinely means nothing on disk.

```
required ⊆ subscribed         → save proceeds silently, no popup (no spam)
non-interactive (auto-save)   → ONE console warning, field untouched, save proceeds
otherwise                     → blocking Yes / No / Cancel dialog
```

| Button | Effect |
|---|---|
| **Update + save** (`yes`) | field := union(current, missing); persists through **this same save**; one log line incl. the restart caveat |
| **Save without updating** (`no`) | scene saves, field untouched, one log line naming the universes left unsubscribed |
| **Cancel save** (`cancel`) | whole save aborted — `{ok:false}`, nothing written anywhere. Escape = Cancel. |

The card shows, in the push flow's own modal skin (`vm-modal-overlay`,
`vm-modal-card led-push-card`, `led-push-warn`, `led-push-subhead`,
`led-push-diff-line`, `vm-modal-actions`) — **no new modal framework, no new
CSS**:

- the silent-drop explanation;
- **the restart caveat, verbatim**: *"⏱ Takes effect at the NEXT sACN bridge
  start. The running bridge keeps the accept-list it built at boot, so nothing
  changes on the wire until the bridge is restarted."*
- the explicit change: `📡 Subscribed Universes: 1, 2, 3 → 1, 2, 3, 27, 30`
- one `+ U<n> — <reason>` line per addition, naming the controller/port/output;
- malformed tokens (the `1-24` trap), if any;
- the extras FYI line (see §4).

### Should the Lighting Controls 💾 behave identically? **YES — and it does.**

The gate is installed in `exportConfig()` itself, which is the **single** save
path: the controller pane's 💾, the Lighting Controls 💾 (`gui_builder.js`
footer), `controller_map_editor`'s save row, `PatchManager.saveAndNotify`, and
the LED per-output push's scene write all funnel through it. One save path, one
behavior — the campaign's one-source-of-truth doctrine. Nothing had to be
duplicated per button.

The **one** exception is deliberate and is the only new argument:
`exportConfig({ interactive: false })` is passed by `debounceAutoSave`'s 2 s
timer. An auto-save may not raise a modal in front of an operator who is
orbiting the camera; instead it logs one warning naming the missing universes
and saying the next explicit 💾 will ask. It does **not** change the field. The
default is `interactive: true`, so every existing caller keeps prompting.

### Failure to derive the set aborts the save

If `computeProjection` / the registry throws (no registry installed, malformed
mapping), the save is **refused loudly** with `⚠ SAVE ABORTED — universe check
failed: …` rather than writing a scene whose subscription field could not be
verified. Same shape as the existing model-export abort. Codex P0: no fallbacks.

## 4. The never-remove rule

The diff is **additive only**. Universes present in the field but used by
nothing in this configuration are reported as one FYI line —

> *FYI: U99 is subscribed but nothing in this configuration uses it — left in
> place. This never removes a universe; a subscription you do not need is
> harmless, one you are missing is dark fixtures with no error.*

— and are carried through into `nextValue` untouched. Reasons: a shrunk
subscription fails **silently**, and the operator legitimately subscribes to
universes this scene's registry knows nothing about (another scene, the engine,
a console on the wire). Pinned by test.

## 5. Files

| File | Change |
|---|---|
| `simulation/src/dmx/subscribed_universes.js` | **new**, pure: `parseSubscribedUniverses` (bridge-exact + malformed report), `formatSubscribedUniverses`, `computeRequiredUniverses`, `computeSubscriptionUpdate`, `describeSubscriptionUpdate`, `syncSubscribedUniverses` (all effects injected) |
| `simulation/src/gui/subscribed_universes_prompt.js` | **new**: live projection inputs, the Yes/No/Cancel dialog in the push flow's skin, `checkSubscribedUniversesBeforeSave()` |
| `simulation/src/gui/gui_builder.js` | `exportConfig(options)` gains `interactive` (default true) and runs the gate before the first write; `debounceAutoSave` passes `interactive:false` |
| `simulation/src/gui/controller_map_editor.js` | 💾 Save Configuration now **awaits** the save and repaints on resolve (the 400 ms guess could not survive a dialog in the path) |
| `simulation/tests/subscribed_universes.test.js` | **new**, 30 tests |

No `scenes/**` and no `marsin_engine/**` writes. `common.yaml` is only ever
written by the existing save-server path, on an operator-triggered save.

## 6. Tests (honest counts)

`cd simulation && npm test`

| | tests | pass | fail |
|---|---|---|---|
| Baseline (measured, this branch) | 1403 | 1394 | 9 |
| After | **1433** | **1424** | **9** |

**+30 tests, zero new failures.** The 9 are the known pre-existing family (8
stale-model / real-scene-parity cases + the compression-margin tripwire) —
untouched, byte-identical list before and after.

New file alone: **30/30**.

Coverage: required-set union from a synthetic registry (DMX ports, LED
per-output, parked, spill, patches-only fixture, empty declared port);
ascending order + deduped reasons; out-of-range and unpatched rejected;
wrong-shaped inputs throw. Bridge-exact parsing incl. the `1-24` range trap.
Subset ⇒ no prompt (a `cancel`-answering stub is wired in and never consulted).
Superset-missing ⇒ prompt with the exact diff text naming controllers.
yes / no / cancel semantics against a mocked dialog (field updated / unchanged,
save proceeded / aborted). Never-remove pinned. Non-interactive deferral.
An unexpected dialog answer throws instead of guessing. Three wiring tests read
the sources to assert the gate really runs **before** `saveModelJS()`, that
`!proceed` returns `ok:false`, that the auto-save timer opts out, that the
controller pane awaits, and that the dialog reuses the existing modal classes
and states the restart caveat.

Parse-check: acorn ESM parse clean on all four touched source files plus the
test; plus a live `import()` probe of `subscribed_universes.js` (all 10 exports
resolve). `python scripts/security_check.py --all` reports nothing in any file
this slice touched.

## 7. What the operator sees next

Nothing until his next explicit 💾. On that save, if the configuration uses a
universe the field does not carry, one dialog appears naming each missing
universe and the controller/port/output that needs it. Answering **Update +
save** writes the widened list into `common.yaml` with the rest of the scene —
and, per the caveat on the card, it reaches the wire at the **next bridge
start**, not before.

## 8. Not done / open

- **Bridge restart is still operator-gated** (report `20260725_60` §"Restart
  required"). This slice fixes the boot list; collecting it needs the restart
  that is already on the list.
- The gate does not (and by rule must not) shrink the field. If the operator
  ever wants extras pruned, that is a deliberate manual edit.
