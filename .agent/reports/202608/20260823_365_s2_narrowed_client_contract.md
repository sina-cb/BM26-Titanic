# 365 — S2: the narrowed client contract (`marsinled_client.js`) + DMX toggle

Implements slice **S2** of `_363` (§2.1 body, §2.2 verify, §3 toggle functions)
plus its `tests/marsinled_client.test.js` block from §5. Everything here is
implemented and gated (`node --check`, targeted `node --test`, greps). **No git
operation, no device contact, no stack bounce, no live-stack port bound.**

Controllers are named by `controllerId`; test fixtures use documentation-range
IPs only.

---

## 1. Objective

Narrow the push CONTRACT in the client to exactly what operator ruling 6/7
allows — strand counts+enables, per-output universes, DMX ON — and add the
per-card DMX ON/OFF toggle's three pure/transport functions. Nothing about the
panel (S3), the docs (S4) or the HIL runner (S5) is touched.

---

## 2. Changes — `simulation/src/dmx/led/marsinled_client.js`

### 2.1 `buildForcedConfigBody` — the narrowed body (§2.1)

The body is now, and only ever, `{ strands, dmx }` (+ `deviceName` under the
unchanged §4.1.1 repair):

| Part | Rule now |
|---|---|
| `strands` | FULL array, read-modify-**write** per entry. Assigned output → `enabled:true`, `count` = mapped px, `dmxUniverse` = plan universe, `dmxStartAddress:1`. Unassigned → `enabled:false` and `dmxUniverse`/`dmxStartAddress` **deleted** (D1). **Every** other key of the entry — `type`, `colorOrder`, `rgbwMode`, pins, dead-pixel fields, any future key — passes through untouched. |
| `dmx` | `{ ...snapshot.dmx, enabled: true, protocol: 0 }`. `timeoutMs`, `universe`, `startAddress` and anything else the board saved are **preserved** (the pre-S2 code hard-replaced the block and dropped them). |
| `swarm` | **never written.** The `'swarm' in snapshot → {…swarm, enabled:false}` branch is deleted; `_362`'s Q1 is withdrawn. The board's swarm config survives byte-for-byte because it is never mentioned. |
| `gamma` | never written (never was; now stated and test-pinned). |
| `deviceName` | unchanged `deviceNameRepairForPush` doctrine. |

New shared guard `requireSnapshotDmx(snapshot, where)`: a snapshot without a
`dmx` **object** throws loudly rather than letting either writer invent the
block (codex P0). A snapshot without `strands[]` still throws as before.

`FORCED_DMX_BLOCK` (the `_362` frozen export) is **deleted**, and the
`DENIED_PUSH_KEYS` comment block rewritten: there is now ONE declared exception
(`deviceName`), not two — `swarm` is denied on every path, forced push included.

### 2.2 `diffForcedConfig` — the narrowed verify (§2.2)

Asserted: per-index strand `enabled`; on enabled outputs `count` /
`dmxUniverse` / `dmxStartAddress === 1`; **new D1 read-back clause** — a
DISABLED output whose read-back still carries an integer `dmxUniverse` is a
mismatch (`output N: device still reports U27 on a DISABLED output — the push
wrote no universe there (firmware all-or-none)`); `dmx.enabled === true` and
`dmx.protocol === 0`; `status.sacn.enabled === true`; `dmxOwnsOutput` only when
the firmware reports the field; identity vs the pre-push `controllerId`.

Removed: the `body.swarm !== undefined → swarm.enabled === false` clause.
Never asserted (now test-pinned as deliberate): strand `type` / `colorOrder` /
`rgbwMode` / pins, `dmx.timeoutMs`, `swarm.*`, `gamma`.

`err.perOutputMismatch` shape and the panel's full-body provenance hashing are
untouched, and `diffForcedConfig`'s signature/return type are unchanged.

**The informational swarm note** is a NEW separate pure export,
`swarmEnabledNote(verifyConfig)` → the plan's exact wording
(`ℹ board also reports SWARM enabled — swarm is operator-managed; the sim does
not touch it`) or `null`. It is deliberately NOT inside `diffForcedConfig`'s
array: that array is the pass/fail verdict, and a note riding inside it would
turn an intended state into a failure (and would break every
`assert.deepEqual(diff, [])` caller). S3 renders it on the outcome line.

### 2.3 The DMX toggle (§3) — three new functions

- `buildDmxToggleBody({snapshot, enabled, controllerName, ip})` — PURE.
  `{ dmx: { ...snapshot.dmx, enabled } }` + `deviceName` only under the repair.
  Throws on a missing/non-object `dmx` and on a non-boolean `enabled`.
- `diffDmxToggle(verifyConfig, verifyStatus, enabled, expected)` — PURE.
  Mismatches for `config.dmx.enabled !== enabled`,
  `status.sacn.enabled !== enabled`, identity vs `expected.controllerId` (only
  when stated). Nothing else — the toggle claims nothing about strands/swarm.
- `pushDmxToggle(ip, body, {writeTimeoutMs})` — transport-only mirror of
  `pushForcedConfig`: refuses a flat `timeoutMs`, validates only `body.dmx`,
  does **no internal GET**, same `writeResponseLost` semantics, same D2 rule
  (any ANSWERED non-2xx — 400, the staged-config **409**, anything else — is a
  definite loud failure and is never flagged ambiguous).

### 2.4 Deliberately NOT touched (§2.3-5)

D2 outcome classification (lives in the panel), the one-read-per-attempt rule,
`writeResponseLost` arbitration, the three budgets (12 s / 45 s / 1 s) and
`awaitReboot` — unchanged, byte-for-byte.

---

## 3. Test changes

### `tests/marsinled_client.test.js` (§5 block)

**Deleted (5):** `FORCED_DMX_BLOCK by value`, `flips swarm.enabled`,
`OMITS swarm`, `refuses a swarm key that is not an object`,
`diffForcedConfig checks swarm.enabled ONLY when the body carried the key`.

**Added (15):**

- `_363: the narrowed forced body, in full — one golden deepEqual` — a
  deliberately hostile snapshot (DMX off, ArtNet, own `timeoutMs`/`universe`/
  `startAddress`, a `swarm` block, a `gamma` block, mixed chip types/colour
  orders, a stale universe on the output about to go dark, and
  `futureFirmwareKey`) → one `assert.deepEqual` of the WHOLE body. Proves
  pass-through of `type`/`colorOrder`/`rgbwMode`/pins/dead-pixels/the novel
  key, the forced keys, D1 stripping, the `dmx` merge with `timeoutMs`
  preserved, and no `swarm`/`gamma` key.
- `the body merges INTO the board's dmx object — it never invents one`
- `a snapshot with NO dmx object is a loud refusal` (missing / string / array)
- `FORCED_DMX_BLOCK is GONE` (grep-style: `'FORCED_DMX_BLOCK' in ns === false`)
- `D1 — a DISABLED output still reporting a universe is RED` (+ the green case)
- `the verify is NARROWED — type/colorOrder/timeoutMs/swarm may differ
  arbitrarily` (the narrowing pin)
- `a swarm-enabled read-back produces the INFORMATIONAL note, never a mismatch`
- 8 toggle tests: golden bodies ON/OFF with protocol+timeoutMs preserved and
  only `dmx` as a key; deviceName repair present/absent/refusal; refusals
  (no `dmx`, non-boolean state); `diffDmxToggle` green/red per clause both
  directions incl. identity-only-when-stated and strand/swarm noise ignored;
  byte-equal POST with **zero** GETs; `writeResponseLost` on silence; D2 across
  400/409/503; flat-`timeoutMs` and bad-body refusals.

The deviceName repair present/absent/refusal cases for the PUSH body were
already covered by the surviving `_362: buildForcedConfigBody repairs an
INVALID stored deviceName, and only then`; the snapshot-without-`strands[]`
refusal by `_362: … validates the APPLIED array before any POST`.

### `tests/per_output_push.test.js` — minimal updates taken from S3's scope

Three edits, all forced by the client change (nothing else from S3's block was
done here):

1. `_362: the forced POST carries strands + dmx …` — the golden `dmx` is now
   the board's own object merged (`{enabled:true, protocol:0, universe:1,
   startAddress:1, timeoutMs:3000}`); the `deepEqual(posted.dmx,
   FORCED_DMX_BLOCK)` line becomes explicit `enabled`/`protocol` asserts plus
   `'swarm' in posted === false`.
2. `a board in SWARM is pushed with no refusal, and leaves SWARM` → renamed
   `_363: … and its swarm config is NOT touched`; asserts the body carries no
   `swarm` and no `gamma` key.
3. The fleet three-mode loop's `calls.lastBody.swarm.enabled === false` →
   `'swarm' in calls.lastBody === false`.
4. The now-unused `FORCED_DMX_BLOCK` import removed.

The rest of S3's `per_output_push` block (pre-write identity gate, the swarm
informational note on the outcome line, the sync-chip swarm-clause removal)
is **left for S3** — `_362: a board in SWARM with a PERFECT mapping reads
DRIFT` still passes unchanged, because `computeSyncState`'s swarm clause lives
in the panel and this slice did not touch it.

---

## 4. Gate results

### `node --check`

```
OK  src/dmx/led/marsinled_client.js
OK  tests/marsinled_client.test.js
OK  tests/per_output_push.test.js
```

### `node --test`, from `simulation/`

| Suite | before | after | fail |
|---|---|---|---|
| `tests/marsinled_client.test.js` | 43 | **53** | 0 |
| `tests/per_output_push.test.js` | 91 | **91** | 0 |
| both together | 134 | **144** | 0 |

(`marsinled_client` before = 43 test declarations in the pre-edit file; the
delta is exactly −5 deleted / +15 added. `per_output_push` gained and lost no
test — only three existing bodies and one import changed.)

Regression fences, all green, none of them a live-stack port binder:

- `led_controller_ui_round2`, `led_discovery_scene_liveness`,
  `shared_address_ui`, `controller_registry`, `theme_parity`,
  `bridge_route_readback`, `chained_led_patches`, `led_metadata` →
  **164/164**
- `bench_mirror`, `bench_mirror_resolve`, `bench_mirror_state`,
  `bench_mirror_arm`, `bench_mirror_reverse` → **186/186**
- `controller_pane_ergonomics`, `led_bind_affordance`, `provisional_binding`,
  `led_wire`, `controllers_pane_toggle`, `subscribed_universes`,
  `led_gamma`, `led_gamma_workflow`, `led_gamma_push_devicename` →
  **186/186**

`npm run check` was **not** run (it binds/sweeps live-stack ports; the
operator's stack is up — `_363` §7 rule).

### Greps

| Gate | Result |
|---|---|
| `FORCED_DMX_BLOCK` over `simulation/` | **0 code hits** — 3 hits, all inside the new absence-assertion test (the S1 permitted-mention precedent) |
| swarm WRITE evidence in `marsinled_client.js` (`swarm\s*[:=]`, `.swarm =`, `body.swarm`) | **0 writes** — one hit, `const swarm = verifyConfig.swarm` inside `swarmEnabledNote` (a READ of the read-back) |
| `swarm` anywhere in `buildForcedConfigBody` | **0** (only the doc comment above it stating the key is never carried) |
| `gamma` in `marsinled_client.js` | **0 code** — 4 comment hits (the `_124` root-cause note + three "not written / gone" statements) |

---

## 5. Deviations from the brief

1. **The swarm note is a separate export, not a `diffForcedConfig` return
   value.** `_363` §2.2 says the note is "surfaced in the outcome line" and is
   non-failing, without naming a mechanism. Putting it in the mismatch array
   would make it fail the push; attaching it as a property of the returned
   array would break `assert.deepEqual(diff, [])` for every caller. So
   `swarmEnabledNote(verifyConfig)` is exported alongside, and S3 calls it where
   it renders the outcome line. The plan's ℹ wording is verbatim.
2. **`dmx.universe` / `dmx.startAddress` are now PRESERVED** where the `_362`
   code deliberately dropped them. That follows §2.1 literally ("`timeoutMs`
   and any other `dmx` key are PRESERVED from the board"), and the golden body
   pins it — flagging it because it is a real change in what lands on a board
   whose legacy global mapping fields are stale. They are inert while
   per-output universes are in force.
3. **Four `per_output_push.test.js` edits** taken from S3's scope, listed in
   §3 above. Each is directly caused by the client narrowing; nothing
   discretionary was done there.

---

## 6. Open gaps (for S3 and later)

- `led_discovery_panel.js` still carries swarm-era copy and behaviour:
  `FORCE_PUSH_WARNING` / `FORCE_PUSH_ALL_WARNING` say "A board in SWARM mode
  leaves SWARM mode" (now false), `computeSyncState` still drifts on
  `snapshot.swarm.enabled === true` (§2.3-3 removes that clause), and the
  provenance comment at ≈1486 still lists `swarm` among the hashed keys. S3.
- The pre-write identity gate (§2.3-1), the toggle UI + label seeding, and the
  outcome-line rendering of `swarmEnabledNote` are S3.
- No browser evidence was produced — this slice ships no UI, and a launcher
  bounce is operator-timed.
- `docs/MARSINLED_API.md` still documents the `swarm` force payload and the
  frozen dmx block (S4, `_363` §2.4 rows 5 and 8).
