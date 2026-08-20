---
name: 20260725_88_master_doc_archive
type: report
created: 2026-07-30
---

# `_88` — Master-doc archive (end-of-day compaction, 2026-07-30)

**What this is.** The BM26 Show Readiness master doc
(`.agent/projects/bm26_show_readiness.md`) had grown past 3,650 lines. On the
operator's end-of-day order — *"Clean up the project file now, and compact it
a bit, keep the Threads, and get ready for new threads to start maybe
tomorrow. Move the compacted data to a report in the `.agent`."* — the doc was
compacted to a working board and everything removed was moved **here,
verbatim**.

**This is an archive, not a digest.** Nothing below has been summarised,
re-worded, or shortened. Each section carries a header naming where in the
master doc the block came from, and the section order follows the doc's own
order. The only text that is mine rather than the doc's is the short
orientation line under each header and the resolved-items ledger in §3.

**The live doc points here.** `.agent/projects/bm26_show_readiness.md` keeps
the operator's RULE, the Threads board, a compact status snapshot, the
standing orders, the still-open waiting items (original numbers preserved),
one-to-three-line workstream rows, and the most recent decisions — every one
of them pointing at the matching section below for the full history.

**Provenance / integrity notes:**

- Content is copied byte-for-byte from the master doc as it stood at the end
  of 2026-07-30, after the `_67` redaction sweep. **Redactions are preserved
  verbatim** — where the doc reads `10.x.x.60` / `10.x.x.151`, so does this
  archive. No full IP was reintroduced anywhere in the move.
- The canonical, most-current campaign state is and remains the thread
  tracker, `.agent/memory/bm_readiness_thread_tracker.md`. This archive is
  history; the tracker is truth.
- Reports referenced throughout live at `.agent/reports/202607/20260725_N_*.md`.
  Next free report number after this one: `_89`.
- The work described below was committed and pushed on 2026-07-30 as
  `3246deb2` on `feat/bm_readiness` (441 files, reports `_47`-`_87` included).

## Contents

1. Threads board (verbatim, as it stood before compaction)
2. Status snapshot — orientation, landed-today detail, standing orders, the
   slice-by-slice `_58` push/save wave, doc debt, the 2026-07-29/30
   mapping-support wave block
3. Waiting on the operator — all 26 numbered items, resolved and open
4. Operator requirements (verbatim intent, 2026-07-27) — full section
5. Workstreams — the full row bodies, R1-R10
6. Open decisions (Sina) — the full numbered list
7. Specialty & themed playlists (operator, 2026-07-27)
8. Decisions log — the full list
9. Log — every dated entry through 2026-07-30

## 1. Threads board (verbatim, as it stood before compaction)

From the master doc's `## Threads` section. The live doc keeps this board,
refreshed to end-of-day truth; the long **LANDED TODAY** paragraph below is
what was collapsed.

## Threads — what's going on right now (2026-07-30)

> Operator-requested quick-glance board. The coordinator maintains it
> on every launch/landing/ruling; one line per thread, detail in the
> Status snapshot below + the tracker + the linked reports.

**🔄 IN FLIGHT:** nothing — all agents landed. (`_72` Left Front Deck
validation was stopped operator-side and is cancelled; its three
mid-flight findings were all actioned — halo invisibility fixed by
`_73`/`_75`/`_77`; the two survivors are taste calls in item 21/23:
the unpatched-red rendering and the U23 feed level.)

**⏸ WAITING ON YOU (top of the queue — full list in "Waiting on the operator" below)**

| # | Action | Why |
|---|---|---|
| — | **Hard-reload the sim tab** | Picks up today's fixes in one go: dot scale (`_74`), live halo knob (`_75`), Halo × (`_77`), knob relabels (`_78`), sorted menus (`_80`) |
| — | **Check the roof-edge par row's patching** | `_78` measured only 8 of 40 pars patched — you believed that row was mapped. They now render DARK rather than red (`_81`), so an unpatched row is quiet instead of loud: the patch gap is still real and still yours to close |
| ~~—~~ | ~~Ruling: trace dots in beauty profiles?~~ | **RESOLVED by `_81`** — gated out of `full`/`emissive` by default; Show Generators still turns them on anywhere |
| ~~26~~ | ~~Ruling: undriven-red vs the "Show Unpatched (Red)" toggle~~ | **RESOLVED by `_81`** — option (B): all three indicators obey the toggle; red returns unchanged when you switch it on |
| 18+15+22 | **`.60` card: expect ▲ Drift (normal), ⬆ Push ONCE** | Re-parks output 3 off U23, completes the timed-out write's save+notify, doubles as acceptance step 1 (`_71` §6) |
| 17, 19 | Acceptance run (`_63` §3) · gamma W-preset veto | Unchanged — full list below. **Item 16 (bridge restart) is DONE** — your launcher restart activated S3; `_87` made it the LAST one you need for mapping changes |

**✅ LANDED TODAY:** push/save wave S1–S5 (push saves + notifies, honest per-step dialog; collision gate; bridge runtime subscription; loud failures) · push 5 s timeout → reboot-aware, timeout ≠ failure (`_69`) · **port→output mapping** (out[▾] per port, park-never-disable, sticky parks, 25-case matrix, `_70`/`_71`) · LED gamma sliders + live curve (`_64`/`_65`) · 2D edit-tab persistence + scoped auto-save (`_66`, layout committed `b8b8bca5`) · vintage 2.5× + Uking 3× + DMX halo rim fix (`_68`/`_73`) · patched-fixture dot-scale bug — the real "Left Front Rails small" cause (`_74`) · Global Halo Size reaches every class live (`_75`) · per-fixture **Halo ×** on every fixture, LED and DMX alike (`_77`) · orphan-fixture badges + one-click removal (`_76`; ghosts since deleted by the operator — item 4 DONE, ORPHAN_GROUPS emptied) · security sweep: commit path clear (`_67`) · red-halo verdict: NOT a bug — unpatched-red + genuinely red frames + rims finally visible; knob relabels shipped (`_78`) · Fable DMX-halo double-check: all classes PASS to the digit; ring impostors = trace preview dots in beauty profiles (`_79`) · six menus natural-sorted, display-only (`_80`) · **the red leaves the beauty view (`_81`): undriven-red now obeys "Show Unpatched (Red)" and trace/generator visuals are gated out of `full`/`emissive` by default — both decisions resolved, both toggles still work, live-verified in his stack (0 sACN-OUT, 0 saves)** · **the "big leak" found and fixed (`_82`): unpatched right-side fixtures were being mapped into the analytic SpotLight pool, holding 36 of 60 slots while emitting nothing — now 60/60 go to patched, emitting fixtures and the hull actually lights; "Show Unpatched (Red)" also cloned into ⚙️ Options, two views one value** · **`_87`: ZERO RESTARTS for mapping changes — his restart was a one-time S3 activation (item 16 DONE), and the two links that were still genuinely restart-bound are closed: LED strand SPILL universes (a record's `segments[]`, not just its start) now feed the relay routes and the subscription diff, and the `📡 Subscribed Universes` field is re-read on every recompute instead of only at boot; dialog now says "takes effect IMMEDIATELY on save"**. Suite **1366/1358/8** — the 8 known stale-model failures only, all day, zero new (the sim suite ends the day at **1452/1442/10**; the extra two are the compression tripwire and operator-side scene drift).

## 2. Status snapshot (verbatim, from `## Status snapshot (2026-07-30, mid-day)`)

Orientation, the in-flight note, the full LANDED-2026-07-30 detail block, the
scheduling rule, the standing orders as they read then, the slice-by-slice
`_58` push/save wave narrative, the doc-debt note, and the
"Landed 2026-07-29/30 — the mapping-support wave" block.

## Status snapshot (2026-07-30, mid-day — read this first)

**Orientation for any reader:** reports live in
`../reports/202607/20260725_N_*.md` (N assigned centrally; ledger in the
thread tracker — `.agent/memory/bm_readiness_thread_tracker.md` is the
canonical, most-current state; next free `_88` — `_86` is DONE: the
`📡 Subscribed Universes` field is no longer a landmine. `exportConfig()` now
recomputes, before the first byte is written, every universe the configuration
actually uses (DMX ports, LED per-output, PARKED outputs, strand spill,
patches) and — only when the field is SHORT — raises a Yes / No / Cancel dialog
showing the exact change and naming the controller behind each addition. Never
removes; auto-save warns instead of prompting. Suite **1433/1424/9** (+30 tests,
failure set unchanged) — `20260725_86_subscribed_universes_autosync.md`.
**`_87` is DONE and supersedes `_86`'s restart caveat: a mapping change now
takes effect on SAVE, zero restarts.** He still had to restart after `_86`
because the running bridge predated `_60`'s S3 — a one-time activation, now
collected (waiting item 16 DONE). `_87` traced every link of
save → `notifySacnBridge` → `recomputeRoutes` → subscription diff →
`addUniverse` → relay and found two that were genuinely restart-bound: **(A)**
`readSceneRoutePairs` read only a patch record's START universe, so an LED
strand's **spill** segments got neither a relay route nor a subscription — dark
pixels past channel 512 with `Route created` in the log and a green monitor,
and restart-proof (the boot scan had the same hole); **(B)** the
`📡 Subscribed Universes` field was boot-read only, and it is the operator's
only way to declare a universe nothing in the config implies (his U32–U37
today). Both fixed with re-reads and shared pure helpers — one parser for the
field on server and browser, pinned by a parity test; one reader for "what a
patch record occupies", used by the boot scan and the runtime diff. Dialog now
says *"Takes effect IMMEDIATELY on save — no bridge restart"* and names the log
lines to watch (`runtime-subscribed U…`, then `First frame on U…`). Verified by
running the real bridge with faked sockets against the real scene files.
Suite **1452/1442/10** (+19 tests, failure set byte-identical; the 10th is
operator-side scene drift, not new) —
`20260725_87_no_restart_subscription.md`; `_85` is DONE: the
controllers pane's `💾 Save Configuration` button no longer paints over the
UNMAPPED tray chips (a flex overflow, not absolute positioning — the tray
could shrink below its own content while staying unclipped, and `_65`'s
taller gamma cards pushed the column negative). The button now has its own
non-shrinking `.cm-footer` row, the tray clips + keeps a docked floor, and the
chip grid scrolls with no min-height floor; 0 px overlap measured in both
collapse states, suite 1403/1394/9 —
`20260725_85_unmapped_tray_layout.md`; `_80`, the left-menu
name sort, is DONE (see the Log); `_79`, the read-only
Fable DMX-halo double-check, is DONE: all five verification points PASS,
`_78`'s disproof independently confirmed, one NEW finding — trace
generator preview dots/handles render in the beauty profile and read as
wrong-colored halo rings; see `20260725_79_dmx_halo_doublecheck.md`.
`_81` is DONE and closes that finding AND item 26: both reds are now
behind toggles the operator already owns, and the Left Auditorium red he
named third is measured PATTERN CONTENT that will remain —
`20260725_81_undriven_red_gating.md`. `_82` is DONE: his "big leak" was
REAL and literal — unpatched right-side fixtures were being mapped into
the analytic SpotLight pool, holding **36 of 60 slots while emitting
nothing** and starving the patched left side; fixed at the request
source, plus the "Show Unpatched (Red)" switch cloned into ⚙️ Options —
`20260725_82_unpatched_halo_leak.md`. `_83` is DONE: moving a generator
now moves its generated fixtures, live AND after a reload — two causes,
both killed at the root (the anchor had two computations; there is one
now) — `20260725_83_generator_move_fixture_sync.md`).

**IN FLIGHT right now (2 agents):** `_72` = Left Front Deck VISUAL validation
(operator-authorized screenshot passes, strictly read-only — nails
down what "still bad" is: U23 feed content vs halo collapse at low
luminance vs anything else, ranked fix recommendations, no code).
`_73` (Uking pars 3.0× + the DMX halo rim fix, FPS gate passed on
the verified 4090) LANDED — see the Threads board and
`20260725_73_uking_par_scale_halos.md`.

**LANDED 2026-07-30 (this session):** `_76` = **orphaned fixtures are
flagged and removable in the sim** — a fixture claiming generator origin
whose generator no longer exists now carries a red badge on its group
header and its own row, the `📐 Group Generator` header carries
`⚠ N orphaned fixtures`, and there are delete controls one-by-one AND
group-by-group, each enumerating every dependent before it acts. Item 4
is now a click for him (and the real count is **6**, not 7). Then: the
full `_58` push/save wave
S1–S5 (`_59`–`_63`) — **complete in code**, pending the operator-gated
live acceptance (item 17); `_64`/`_65` = LED gamma UI (firmware-style
sliders + Link RGB + presets + live curve plot replacing the four
textboxes; device's own web console predates its gamma card — sim is
the supported path until his private-repo reflash); `_66` = 2D
Pixel-Map EDIT-tab persistence (the layout had NO YAML wiring at
either end and never reached disk — now its own `pixel_map_views.yaml`
sidecar + scoped debounced auto-save; needs ONE operator server
restart for the new save route, item 20); `_67` = security redaction
sweep (56 → 6 findings, all 50 `.agent/` IP findings gone; the 6 left
are a MAC in gitignored scene backups — **the commit path is CLEAR**);
`_68` + addendum = vintage lights 2.5× in 3D, verified GLOBAL (its
addendum's "brightness, not size" verdict is **SUPERSEDED by `_74`** —
the probe was accurate but only saw the per-fixture emitter layer;
`_74` found the real defect one layer up and it IS size);
**`_74` = the fix** — the scene-wide instanced-dot mesh (one
`InstancedMesh` over all 971 titanic pixels, and the ONLY emitter in
the `pixel_mapping` profile) placed and sized its dots from the
PHYSICAL `x/y/z` + `pixelSize` and never saw `fixture_model_scale`;
since every unpatched dot is forced black/overlay-red, the pre-scale
dots showed on exactly the patched fixtures — hence "only Left Front
Rails". Pixel map now carries drawn `rx/ry/rz` + `renderScale`
alongside the untouched physical fields (runtime-only, exported model
byte-identical); all three dot writers go through one new
`pixel_dot_geometry.js` that throws on physical-only data. Suite
1232/1224/8, +8 tests, zero new failures; before/after captures from a
readonly-guarded pass (0 sACN-OUT, 0 saves) reproduce his screenshot
exactly. Needs one hard reload to see (item 23);
**`_75` = Global Halo Size is now ONE knob for every bus** — two
independent defects, measured live before/after: LED strands were
missing from the slider's handler entirely (halo frozen at build
time), and every MULTI-pixel DMX fixture had its halo bounded by the
OPAQUE BULB's pitch ceiling, so it pinned at `bulbCeiling × 1.8` from
haloScale 1.0 up (he sits at 1.4). Single-pixel pars escaped, and the
TE sign is LED-bus — the one class both defects skipped, hence "only
the TE sign lights". Halo now has its own looser ceiling
(`MAX_HALO_PITCH_MULTIPLE = 1.5`, derived as `0.3 × maxRim` — the
smallest bound that lets the knob reach its top end) and the handler
reaches strands. All 6 classes verified MOVING 0.1→5 in his live sim
(0 sACN-OUT, 0 saves). Suite 1237/1229/8, +5 tests, zero new failures.
**Live on the drag — no reload needed for this one;**
**`_77` = per-fixture LOCAL halo scale** (his ruling on item 24:
*"local is maybe a scale for the global?"* + *"LED fixtures, DMX
fixtures are both fixtures"*): the model is now
`base × Global Halo Size × config.haloScale`, three factors. ONE
property name, one resolver, one `Halo ×` field (0.1–10) in BOTH
places fixtures are edited — the DMX/par folder (which already serves
the LED-bus TE Sign panels) and the per-strand folder. Absent/1.0 is a
byte-identical no-op so old scenes are untouched; garbage throws
naming the fixture; nothing is silently clamped; the DMX pitch ceiling
applies AFTER the local multiplier so an override can't reopen the
smear hole. Bulk-set across a selection rides the existing
`propagateToSelected` (no new group machinery). Live-verified ×2 on all
six classes in his sim (0 sACN-OUT, 0 saves, configs restored). +10
tests all passing. Item 24 RESOLVED by design, not by merging knobs;
**`_78` = the red par halos are NOT a colour bug** — the "halo mesh
never gets driven colour" hypothesis is DISPROVED by measurement (all
40 pars, patched and unpatched, bulb `instanceColor` ≡ halo
`instanceColor` at the same instant; `_writePixelColor` writes both in
one call). Two legitimate red sources: the roof row is UNPATCHED and
`sacn_mapper.paintUndrivenEntry` paints undriven entries pure red — an
explicit **operator ruling of 2026-06-12 "red, not black"** (`#730000`
= (1,0,0) × sim-brightness 0.451, exact match) — and the patched
auditorium par is genuinely driven orange-red by its live frame
[dimmer 100, R 63, G 27, B 0]. What CHANGED is halo geometry: `_73` +
`_75` took a par's halo from **0.98× its bulb** (buried inside the can,
invisible) to **2.12×** (0.4713 vs 0.2223, housing 0.225), so the red
finally reaches outside the housing. **No code change to any colour or
halo path** — instead a decision is owed (item 26). Bug 2 closed by his
own follow-up ("I was using the LED halo size, not the global one") —
no DMX reach defect, `_75` stands; shipped label/tooltip hardening
only. +5 tests pinning halo-follows-bulb per class + perf P0;
`_69` = per-output push timeout fix (one 5 s constant aborted
mid-reboot on healthy hardware EVERY time; now reboot-aware budgets
8/12/45 s + timeout-then-read-back arbitration — a lost write reply is
verified, never declared failed); `_70` = port→output association
design + `_71` = its implementation (per-port `output:` selector,
park-never-disable, enable-only asymmetry, uniqueness/range refusals,
the three downstream holes closed; suite 1224/1216/8, +40 tests, zero
new failures — live acceptance is item 22). Earlier same-day: `_57` docs/41 per-output
contract re-base (22 claims fixed). Some LED-related evidence
deliberately lives OUTSIDE this public repo in `~/tmp` (color/white
reviews, controller debug transcripts `~/tmp/led_controller_debug/`) —
an operator privacy rule for external-hardware detail; rows here carry
only the BM-side facts.

**Scheduling (operator rule, 2026-07-28):** dated deadline/schedule
planning is tracked in `.agent/reports_local/` — a **gitignored,
local-only** reports set (see its README). Future dates and deploy
deadlines must NOT appear in tracked files; this doc records what and
why, never when-by.

**Standing orders in force:**
- **NO deploys to titanic-ext** — operator develops locally now and
  deploys himself. (Remote is currently ONE deploy ahead-and-consistent
  with local through `_26`; nothing remote-edited was overwritten.)
- Operator runs his own Expo/Metro on :6967 — agents never touch it;
  CaptainPad verification happens on `:7167` dist builds.
- **Controller firmware work PAUSED** (flash requires USB per unit);
  the HTTP config API is the supported path for controller settings.
- **White-pattern residual work PAUSED** ("colored patterns look good")
  — diagnosis + ready-to-go fix plans on file in ~/tmp; resume only on
  explicit ask. RGBWAU→LED color path is operator-ACCEPTED.
- Commits are operator-gated; the tree carries ~160+ dirty files of
  validated, uncommitted work on `feat/bm_readiness`; nothing pushed.
- **Operator is LIVE-MAPPING real DMX/LED controllers** (started
  2026-07-29): all agent browser work runs readonly-guarded (no saves,
  no output-enable touches, sACN OUT socket blocked, short sessions);
  `simulation/scenes/**` + models are operator-owned — the ONE
  exception on record is the operator-ordered coordinator scene fix of
  2026-07-30 (Left Back Wall ghosts + rename, see Decisions log).
- **Standing order (2026-07-30):** doc contradicting verified
  code/hardware behavior → fix + clean up on sight
  (`.agent/memory/doc_inconsistency_standing_fix.md`).

**The `_58` push/save wave, slice by slice (ALL LANDED — kept for
reference; live acceptance is item 17):** **S1 is DONE (`_61`):**
⬆ Push no longer stops at the device — after the write+verify it runs
the full scene save (Option A, the operator default: same
`exportConfig` the 💾 buttons use, now awaitable and answering
`{ok, reason}`) and THEN notifies the sACN bridge, reporting each step
in the dialog (`✓ device written + verified · ✓ scene saved (patches
projected) · ✓ bridge notified — routes follow`). Any failure is red,
names the stale layer, and states that the device WAS written and
cannot be rolled back — the write is never reverted. The confirm dialog
declares the save up front; push-all does one save+notify after the
sequence. `notifySacnBridge` now returns success/failure ("WS not
connected" is a FAILURE, not a warn). Code + unit tests only (sim
suite 1099→1111 tests, 1091→1103 pass, same 8 known stale-model
fails); **the live acceptance run is operator-gated** (item 17).
**S3 is DONE (`_60`):**
the sACN-in bridge now re-subscribes its receiver on every route
recompute, so a universe patched after boot can no longer produce a
relay route that logs "created" and carries nothing. Code + unit tests
only; **it takes effect only on a bridge restart, which is
operator-gated** (item 16 below) — nothing was restarted.
**S4 is DONE (`_62`):** the `saveAndNotify` 500 ms race is dead — the
bridge notify is chained on the AWAITED save (the old timer always
fired 1.5 s before the 2 s debounce even started writing, so the bridge
always re-read a STALE `patches.yaml` and reported success), and a
failed save now means NO notify at all. Both failures are LOUD:
`console.error` + the red save toast + a red line in the sACN-IN
monitor log, naming the stale layer and the reconnect self-heal (the
untouched `sacn_input_source` re-send). The post-save notify inside
`exportConfig` is awaited and loud too — that is what makes "a save
alone is sufficient" true for the 💾 buttons. Caller note: the
auto-subscribe path deliberately does NOT force a save (it arms the
shared debounce and skips the notify — with autoSave off nothing is
written, so a notify would only re-read the old file). Duplicate notify
on a push is KEPT by decision (both halves load-bearing; `setScene` is
idempotent) — loudness split instead: save paths loud, push quiet +
self-reporting. Code + unit tests only (sim suite 1111→1121 tests,
1103→1113 pass, same 8 known stale-model fails).
**S5 is DONE (`_63`) — THE `_58` WAVE IS COMPLETE IN CODE.** The sync
chip now states what it measures on every tooltip ("Measures the DEVICE
against the per-output plan this page would push (device ≡ plan) — NOT
the sACN feed…"), reading consistently with S1's post-failure detail;
the ⬆ Push button tooltip no longer describes a device-only push;
`docs/41` gained **§4.5** (push saves + notifies; a 💾 save alone is
sufficient for mapping-only changes and notifies AFTER the write; a
failed notify is loud + self-heals on WS reconnect; two `setScene` per
push are BY DESIGN; the bridge runtime-subscribes new universes but
needs one restart to activate; pixel-count changes still need
`.agent/ops/engine_model_refresh.md`), plus §3.5's registry-aware gate,
a header pointer, and the §7 "cross-controller overlap is non-blocking"
claim corrected (false since S2). Copy review found ONE real drift —
"the sim feed" vs "the sACN feed" — normalised to **the sACN feed**
across all four operator-facing strings (5 pinned test assertions
updated with it); the `U23` shorthand in S2's collision message was
flagged and deliberately left. Sim suite 1121→1134 tests, 1113→1126
pass, same 8 known stale-model fails (+4 of those tests are S5's; the
rest are `_65` landing concurrently — no NEW failures).
**The only thing left for this wave is the operator-gated live
acceptance run — the full 3-test checklist (push-only / save-only /
WS-down save) plus the four standing gates it interacts with is written
into `_63` §3.**

**Doc debt cleared:** `_57` re-based `docs/41` onto the **per-output**
LED contract (first application of the doc standing order) — §3
rewritten (one independent sACN receiver per output on its own
universe, start 1; port = output slot; plan rules; corrected worked
example), plus §2 discovery window 6.5 s/64 + bind-by-`controllerId`
(not IP) + MAC-never-persisted, §4.1 per-strand `dmxUniverse`, §4.3
verified reboot endpoint / no restart button, §5 `alsoFlat` dual-send
answered, §6 marked historical, stray tool-residue at EOF removed.
Stale linear-mapping memory fact corrected too. 22 claims fixed, each
cited (`20260725_57_docs41_per_output_contract.md`).

**Landed 2026-07-29/30 (the mapping-support wave, all validated with
screenshots + tests, zero scene writes except the sanctioned fix):**
rename hygiene `_47` (mapped renames enumerate-then-invalidate loudly);
2D pixel-map overhaul `_48` +4 addenda (front=front lights only w/ 4
smokestack ropes, top-down side-gap compression + distinct bars +
small stacks, TE sign rotate + one-panel-per-sign, name-drift repairs
×3 + structural tests, ORPHAN_GROUPS general tripwire); LED halo
parity `_49` (halo keyed on bus:led, sliders reach everything);
Controllers pane `_50` +addenda (collapse toggle, 2-row header w/ full
name, SIM-ONLY pill relocation, natural name-sort of tray+picker w/
per-keystroke perf fix); Left Back Wall debug `_51` + operator-ordered
coordinator scene fix (5 ghosts deleted, trace+fixtures renamed, 0
stale refs, scene 87 fixtures); LED menu `_52` +addenda (group rename
w/ scene-wide namespace guard across all 5 entry points, LED +port
lowest-free-slot device-contract fix, GUI-wide wheel guard — Chrome
number-input stepping defeated, negative-control proven); vintage
sizing `_53` (pitch-derived 0.3 core ceiling, before/after at max
sliders); view adjustability `_54` +fit-to-visible ⤢ (persistent
framing, per-view knobs, reset-to-default, obstruction-aware fit);
edit-mode move + right-click group select `_55` (per-fixture offsets
post-fit, silent no-op class killed); .60 controller debug `_56`
(device healthy; bind-affordance bug FIXED — IP match ≠ binding;
restart control doesn't exist — rebootDevice() is dead code, endpoint
verified live).

## 3. Waiting on the operator — the full list as it stood

All 26 numbered items verbatim, resolved and open alike. The live doc carries
only the OPEN ones, with their **original numbers preserved** (they are
referenced across the reports).

**Resolved / retired at this compaction — one line each, full text below:**

- **1** — press `Bind` on the `.60` card: **DONE**.
  `scenes/titanic/controllers.yaml` now carries a `device:` block with
  `controllerId: testbench` on the `LeftLeftRopes` controller.
- **4** — the Left Center Auditorium ghosts: **DONE**. `_76` made them
  clickable, the operator deleted them, `ORPHAN_GROUPS` is now empty.
- **16** — restart the sACN bridge to activate S3 (`_60`): **DONE**. His
  launcher restart activated S3 and picked up `_86`'s widened boot list;
  `_87` then made it the LAST restart a mapping change ever needs.
- **20** — restart the sim server for the `_66` pixel-map save route:
  **DONE**. The same launcher restart served it and the layout reached disk —
  `scenes/titanic/pixel_map_views.yaml`, committed as `b8b8bca5`.
- **24** — Global Halo Size / the "two knobs?" question: **RESOLVED** by his
  own ruling plus `_77` — the model is
  `base × Global Halo Size × per-fixture Halo ×`, three factors.
- **26** — how loud the unmapped-fixture red should be: **RESOLVED** by `_81`,
  option (B) — all three indicators obey "Show Unpatched (Red)".
- **15 / 18 / 22** — still open, but **merged in the live doc into one action**
  (the `.60` output-3 re-park, the `_69` re-push, and the `_71` live
  acceptance are one push). Their full separate texts are below.
- **23** — hard-reload the sim tab: still owed, but promoted to the Threads
  board's top row instead of being carried as a numbered item.

**Waiting on the operator (no agent action until he moves):**
1. Press the now-present **Bind** button on the .60 card (reload sim
   first) — writes the missing `device:` block.
2. **⟳ Restart-device button** on LED controller cards: yes/no (`_56`).
3. Titanic **re-export + engine restart** — clears the standing 8
   suite failures + 337 parity errors (owed since yesterday).
4. The **Left Center Auditorium ghosts** — **now OPERATOR-CLICKABLE via
   `_76`**, and there are **6**, not 7 (his own 14:28 save already took
   `Left Center Auditorium 5`). Reload the sim: `📐 Group Generator`
   reads `⚠ 6 orphaned fixtures`; remove them one by one from each
   badged fixture card, or all 6 at once from the group's
   `🗑 Remove 6 orphan(s)` / the Generators banner. The confirm
   enumerates every dependent first (patches, patch-tree records,
   2D pixel-map selectors + offsets, the group disappearing, the
   exported model pixels). Nothing is written until HE saves — and
   the model needs a RE-EXPORT afterwards. Same junk evidence as the
   resolved Left Back Wall 5. **Once the group is empty, drop
   `'Left Center Auditorium'` from `ORPHAN_GROUPS`** in
   `pixel_map_view_defaults.js` (+ the copy in
   `agent_tools/pixel_map_view_tuning_verify.cjs`) — the `_51` Trap-3
   follow-up; its tripwire test will go red on purpose to say so.
5. **TE Sign duplicate fixture names** (both groups carry
   `TE Sign V3 A/B`) — pick an option from `_52` §3.
6. **Clear-All test-controller checkbox** (~3h, design in `_50`) — go?
7. **Per-selector stale-name sweep** (~2-4h, design in `_48` Add.2) — go?
8. **Membership editing** for 2D views (~0.5d, design in `_54`) — go?
9. **Free-placement layout mode** for edit-mode moves (`_55` offer)?
10. Migrate-addresses opt-in (11b) y/n; step-11 loud-refusal
    ratification (`_47`).
11. Global Pixel Size slider can't reach LED strands (why it crept to
    5) — fold strands in vs relabel (`_53`).
12. Top-Down bar-width narrowing (17→14) partially walks back the
    `_40` ruling on that view — veto available (`_48` Add.4).
13. Relay to the external WiFi/Ethernet agent: the .60 device reports
    **no Ethernet interface at all** (`_56`) — Ethernet-only may be
    impossible on this hardware.
14. **`_58` push-save scope micro-decision — SHIPPED AS OPTION A
    (`_61`), veto still available:** ⬆ Push now runs the FULL scene
    save (the one proven path) and the confirm dialog says so up front.
    If the "saves everything dirty, not just the mapping" side effect is
    unacceptable, say so and S1 gets re-pointed at Option B (a scoped
    `/save-mapping` endpoint).
15. **The .60's output 3 is enabled on-device at U23 — LeftFrontDeck's
    DMX universe** (cross-controller collision minted by the push
    auto-extender, `_58` §4; inert today, armed). **`_71` HAS LANDED,
    so the remediation is now exactly one push.** Expect the card to
    read **▲ Drift as soon as you open the pane** — that is the
    landmine finally becoming visible, not a new fault: the sync chip
    now compares the FULL output map (assigned + parked + pending
    enables) and the device still carries U23 on output 3. The new
    `Board outputs:` line on the card shows it before you open any
    dialog. **ONE ⬆ Push re-parks output 3** onto a claims-approved
    free universe and the chip goes green. Nothing is disabled —
    output 3 stays enabled, subscribed and dark (nothing routes to a
    parked universe). Combines naturally with item 18's re-push: one
    push settles both.
16. ~~**Restart the sACN bridge to activate S3 (`_60`).**~~ **DONE
    2026-07-30** — his launcher restart activated S3 AND picked up
    `_86`'s widened boot list in one go. That restart was a **one-time
    activation cost, not a workflow step**: `_87` traced the whole
    save → notify → recompute → subscribe → relay chain and closed the
    two links that were still restart-bound (LED **spill** universes
    were invisible to both the relay and the subscription; the
    `📡 Subscribed Universes` field was boot-read only). Mapping
    changes now take effect on save — acceptance recipe in `_87` §7.
17. **Live acceptance run for the WHOLE `_58` wave — the last open item
    on it.** Every slice is proven by unit tests only until this runs
    once on real hardware. Three tests, full checklist + pre-flight in
    **`_63` §3**: (a) change one port universe on the .60 card, press
    ⬆ Push and NOTHING else — expect device✓/save✓/notify✓ in the
    dialog, a route transition in the bridge log, LEDs following with no
    manual save; (b) a mapping-only change + 💾 Save Configuration in
    the controller pane — LEDs follow; (c) with the bridge WS down, a
    save → red toast + red sACN-IN monitor line, then self-heal on
    reconnect. Costs one ~10 s device reboot AND one real scene save
    (which also clears the 8 stale-model suite failures), so it waits
    for the operator. Interacts with items 15 and 16 and with the TE
    Sign duplicate-name save-abort (it surfaces as the push dialog's
    save step failing) — see `_63` §3's gate list. **The push's 5000 ms
    timeout that broke his 2026-07-30 attempt is FIXED (`_69`) — re-run
    that push as the first acceptance test.**
18. **Re-push the `.60` after the `_69` timeout fix, and check its sync
    chip first.** His timed-out push almost certainly DID write the
    device (the firmware reboots before flushing the reply) but recorded
    no provenance and ran no save/notify, so the mirror + `patches.yaml`
    may lag the hardware. The chip on that card settles it (`in-sync` ⇒
    device took it; `drift` ⇒ it did not); either way ⬆ Push again — it
    is a FORCE push and now completes the loop. **Post-`_71` the chip
    will read `drift` regardless**, because it now measures the parked
    output too and the device still holds U23 there — the same one push
    settles both this and item 15.
19. **Gamma preset W-doctrine veto (`_65`):** the sim's `2.2 sRGB` /
    `Punchy` presets hold **W at 1.0** per docs/41 §4.1(d); the
    firmware's own presets put the exponent on W too. Test-guarded as
    shipped — say the word for firmware parity instead. (Related
    follow-up, unnumbered: a verified gamma push still mirrors
    in-memory only — save the scene once after a gamma push until the
    persist slice lands.)
20. **Restart the sim server once** to activate the `_66` pixel-map
    layout save route, then verify: EDIT-tab move → ~1 s →
    `scenes/titanic/pixel_map_views.yaml` appears; page reload +
    server restart → identical layout, no Save press needed; the move
    raises NO unsaved-changes mark.
21. **Left Front Deck verdict pending `_72`** — **largely ANSWERED by
    `_74`:** the front rails looked wrong because the scene-wide dot
    mesh ignored the render scale, and only patched pixels are lit on
    that layer, so only that run showed it. Fixed in code. What is
    still worth `_72`'s eye is the separate question of what the engine
    actually sends on U23 (level, not size).
22. **Live-accept the port→output workflow (`_71` §6, 6 steps) — the
    one thing standing between `_71` and "done".** Unit-proven only
    until it runs once on hardware: expect ▲ Drift on the `.60`, cross
    P1→out2 / P2→out1 and set them back, push (three green `_69`
    phases; a "write reply was LOST … the read-back confirms" lead is
    ALSO a success), GET-verify that output 3 left U23 and that **no
    output changed `enabled`**, then the output-4 case (one row, one
    strand, ENABLE block in the dialog) and the duplicate refusal. One
    ~11 s reboot + one scene save per push. One firmware assumption is
    unverified and step 4 is where it would surface — what
    `sacn.perOutput` reports for a parked-but-enabled output; if the
    read-back fails naming output 3, report it rather than retrying.
23. **Hard-reload the sim tab and check the Left Front Rails (`_74`).**
    That reload is the "regenerate the instances" you asked for — it
    rebuilds the pixel map and every instance, and no runtime cache
    survives it. Their heads should now fill their housings at the same
    size as the unpatched vintage fixtures beside them, instead of
    sitting as small dots at one end. Nothing else in your session was
    touched; no server restart needed.
24. **Drag Global Halo Size and confirm every bus moves (`_75`).** In the
    `full` or `emissive` profile: strands, vintage rails, bars, pars and
    the TE sign should all respond, live, with no stall in the upper
    half of the slider. Nothing to restart (the same one reload from
    item 23 covers both changes). **The "two knobs?" question in this
    item is RESOLVED by your own ruling + `_77`** — not by merging: the
    model is now `base × Global Halo Size × per-fixture Halo ×`, three
    factors, so Global Halo Size stays the one global and the LED
    folder's Halo Size stays the LED-bus BASE radius. Nothing further
    is owed here beyond eyeballing it.
25. **Try the new per-fixture `Halo ×` (`_77`).** Open any fixture in
    the DMX Light Fixtures list (pars, bars, vintage AND the TE Sign
    panels — one panel serves both buses) or any strand in the LED
    Strands list: `Halo ×` sits with Brightness/Intensity, default 1.0
    = exactly today's look, live on drag, and it bulk-sets across a
    multi-selection like every other numeric field there. Values persist
    on YOUR next scene save — nothing was saved by the agent. Two
    open one-liners if you want them: (a) fog/haze machines show the
    field but have no halo to scale — hide it there? (b) LED-bus halos
    still have NO pitch ceiling (deliberate — a sign's halos are meant
    to merge); say the word if you want one.
26. ~~**DECIDE how loud the "unmapped fixture" red should be (`_78`).**~~
    **RESOLVED (`_81`) — your third complaint read as the ruling, option
    (B).** All three unmapped-indicators now obey "Show Unpatched (Red)":
    off ⇒ undriven fixtures go black on bulb, halo and dot alike; on ⇒
    your 2026-06-12 red returns byte-identical, live, no reload. The
    anti-bleed guarantee is untouched. Nothing left to decide.
Plus the older parked items: party ambientFloor calibration; R2
pattern-tuning session; theme culling + party-moment schedule; R4
hardware tests; 20-vs-40 px/strand test_bench question; the eventual
commit wave (security check first).

## 4. Operator requirements (verbatim intent, 2026-07-27) — full section

The live doc keeps a condensed version and points here for the full text,
including the settled party session model (built and shipped in R1).

## Operator requirements (verbatim intent, 2026-07-27)

- Somewhat autonomous fixture; "we have a freaking strong base."
- **Party detection:** audio reactivity must be checked to find the
  threshold for party mode, and tested that it works ON PLAYA. Default
  operation = preplanned program of selected playlists. If party mode is
  detected **sustained for more than ~2 minutes**, start a **party session
  of ~10–15 minutes** ("or something like this — not sure about the end").
  Hard constraint: must NOT catch music from across the playa and sit in
  party mode all the time. **Party mode only takes effect while a timeline
  plan is active, and it is NEVER allowed to override a human operator**
  (precedence: human > operator disable > automation). Division of
  concerns (operator 2026-07-27): the audio companion configures
  DETECTION (thresholds/params); the CaptainPad **TIMELINE tab** owns
  HANDLING — hard disable, trigger playlist, and the session numbers
  (dwell / max session time / cooldown), all backed by the engine-owned
  persisted /party-config authority (plan cue reads it at fire time).
  The companion shows the same disable boolean (proxied, never stored)
  plus a fake trigger for audio-free workflow testing. The Audio tab
  keeps only the OPEN COMPANION link. **Session model (operator
  2026-07-27, final):** sustain (minDwellSec) ALWAYS enforced, no
  toggle; `durationEnabled` toggle — ON = fixed durationMin then
  cooldown; OFF = follow-the-music: session ends WHEN THE SIGNAL
  DROPS — the release sustain is the companion's `offConfirmMs`
  (default 30 s), ONE sustain not two stacked (operator caught the
  double-sustain; timeline-side releaseSustainSec REMOVED), and
  cooldown fully gone in that mode; cooldown kept (own toggle) but
  default cut to 2 min ("I don't like the cooldown generally, but it
  needs to be there anyways"). **Session rhythm (operator 2026-07-28,
  supersedes any once-per-episode behavior):** with a time limit the
  trigger REPEATS — session (12 min) → cooldown mode (clock from
  session END) → armed again while music sustains → next session;
  "one session then ambient forever while the card claims ARMED" is
  explicitly BAD (validation defect D1). Engine restart mid-party
  must never kill party for the night (D2 — "bad too"). Everything
  stable / bulletproof / playa-proof: no mid-show crash paths,
  restart-safe in every mode, staleness-during-session ends it,
  zero-internet operation.
- **Pattern pass:** manually test ALL patterns, tune speeds + default
  parameters, and make sure the tuned results are recorded as playlists.
- **Show program:** a couple of planned party moments; the rest is ambient
  lighting, with a default party-mode playlist triggered by party
  detection.
- **Hardware:** test the LEDs for the smokestack ropes; test the TE sign
  (still being assembled).

## 5. Workstreams — the full row bodies (R1–R10)

This is the bulk of what moved: the complete historical validation detail for
every workstream row, table markup included. The live doc's table now carries
one to three lines per row (state + next action + owner) and points here.

## Workstreams

| # | Workstream | State | Next action | Owner |
|---|---|---|---|---|
| R1 | **Party-mode detection + session logic** | **BUILT + DEPLOYED** (`20260725_12`, live on titanic-ext) — audioPartyStrong detector (4-term AND + debounce, 11 tunable thresholds), staleness guard (companion death → ambient, loud), timeline plan (dwell 120 s → party session → cooldown → ambient defaultCue). **TUNING UI follow-up CLOSED (`_19`, deployed)**: companion **PARTY tab** + engine-owned **`/party-config`** authority (enable/disable, playlist, minDwellSec/durationMin/cooldownSec, duration+cooldown toggles, `effectiveState`), persisted and honoured at fire time. **ADVERSARIAL VALIDATION DONE (`_20`) → CONDITIONAL FAIL, 4 blocking defects, 2 show-stoppers.** SOLID: party-vs-scheduled-cue precedence 7/7, flapping + edge storms 11/11, hostile HTTP input 40/40, WS replay/routing 5/5, restart safety 6/7, follow-the-music + staleness + disable + forced-while-disabled all live-verified end-to-end. BROKEN: **D1** a fixed-duration session fires ONCE per continuous music episode (the mood cue only re-arms on a drop to CALM, so at a real party the rig runs ambient the rest of the night while `effectiveState` says `armed`); **D2** an engine restart mid-party kills party for the night (same latch, persisted) — the "restart-safe in every mode" requirement fails; **D3** the cooldown clock starts at the FIRE not the session end, so the shipped 12 min / 120 s burns the whole cooldown inside the session (`effectiveState: cooldown` unreachable); **D4** an operator takeover mid-session RESURRECTS the session on lease release with a fresh full `durationMin`, even with the mood CALM; **D6** CaptainPad's PARTY card never learns of a transition it isn't already tracking (showed ARMED for 24 s while the engine was `in_session`; ENABLED toggle over a DISABLED pill) — no `partyConfig` WS listener + the poll is gated on the value it would refresh. All root causes are PRE-EXISTING (`triggers.js` mood latch, `_catchUp` resume re-apply) — not in `_19`'s code. **ALL DEFECTS FIXED + DEPLOYED (`_22`, plan `_21`, operator-decided semantics)**: sessions now REPEAT with a time limit — one new `_notePartySessionEnd(endMs)` in `timeline_service.js` is called from EVERY session-end path (window elapsed, follow-music release, operator disable, ownership handover, dormancy, the `_catchUp` end cases) and does both halves — re-stamp `moodLastFire` at the END (D3) and re-arm `moodArmed` (D1) — so continuous music gives `session → cooldown → session …` and `cooldownSec` finally governs the gap; `triggers.js` is UNTOUCHED (byte-identical). A boot re-arm in `start()` (never `_catchUp`) means a restart can no longer kill party for the night while the persisted cooldown stamp is still honoured (D2). `_catchUp`'s resume re-apply is now party-aware: it ENDS the session when the policy is off / the window expired / the mood is calm, and otherwise REJOINS the ORIGINAL window and shape (D4/D5), never writes ambient under a live open-ended owner (D7), and clears an ownership latch whose cue the save deleted (D8). Plus: empty PUT body → 400 (D10) and a corrupt persisted party field → ONE loud boot refusal naming file+field, no half-running timeline, no per-tick spam (D11). **Proof:** `_20`'s probe suite re-run 49/49 (was 38/48), 12 new engine tests, engine `npm test` 2278/2271/**7 = exactly the known env fails**, live full chain walked `armed → in_session (cd 0) → cooldown 25 s → in_session` twice. **REVALIDATION PASS — final gate (`_23`, adversarial):** all 11 stay dead; the probe suite re-ran **49/49** independently and D1/D2/D3/D6 were re-driven LIVE — 240 s of *continuously* forced party audio on a real engine gave **4 sessions** (gaps 18/16/18 s vs a 15 s cooldown) with the mood never dipping to calm, so the re-arms provably came from the session-END bookkeeping and not a calm edge; `cooldown` reachable and `0` in-session throughout; D2 proved on the real state file (`moodArmed:false` on disk → `true` after restart), a mid-session crash still hands out exactly ONE session and a mid-cooldown crash continues the remainder to the second. The fixer's own probe-list came back clean: the `cooldownSec: 0` blip measures **exactly 1 s**, the scheduled-cue re-take is **one deterministic take at handover + `cooldownSec`** (byte-identical replays, no oscillation over 3 600 ticks), and the widened `_establishBaselineIfActive` guard passed a 9-case regression hunt with no "ambient never fills" shape. D11 on a real engine: **exactly one** `⛔ TIMELINE DID NOT START` naming file+field, zero tick spam, clean boot after restore. Cross-checks green (25-save storms move `sessionEndsAtMs` by 0 and flash no ambient; flaps/staleness never move the stamp; 13 cycles → 594-byte state). Suites: engine 7 fails = exactly the known env 7 (zero delta), timeline **317/317**, CaptainPad tsc clean + vitest **869**, swap-wedge 9/9 + 11/11. titanic-ext's deployed engine files are **byte-identical MD5** to the fixed local tree; remote GET byte-identical before/after (no restart/deploy/corruption test there) | **(a) Sina**: calibrate ambientFloor on playa (PARTY tab capture flow). **(b) FYI, flagged not blocking**: with `cooldownSec: 0` sessions run back-to-back (the blip is **measured at exactly 1 s**) — follow-the-music is the intended tool for gapless party; **a `kind: ambient|look` cue with `durationMin` does NOT protect its window — party reclaims the deck at cooldown expiry (`_23` F1); the shipped `playa_default` is immune because every protective cue is `kind: program` with `hold`, so the rule is: use `hold`, not `durationMin`, for a moment that must not be interrupted**; a mid-session `savePlan` while the mood happens to be CALM now ends the session (an undisturbed fixed session still rides a drop out). Two further `_23` findings, both LOW: the D11 boot refusal is **console-only** (`/timeline/state` still 200 with `lastError: null`, so the iPad shows an empty timeline with no banner — pre-existing shape, backlog candidate), and a **second** `mood→party` cue in a plan would never get an END stamp/re-arm (`_partyCue()` resolves the subsystem to the first; `playa_default` has exactly one). Follow-up still open: silence-latch miscalibration | Sina (calibration) |
| R2 | **Pattern tuning + playlist capture**; specialty patterns (WHITE ONLY, UV spike) | **PARKED for Sina's presence** (2026-07-27: "needs me to be here"). Specialty build ~done ON DISK, unvalidated/undeployed: patterns 60–65 (white ×5 + uv_only), themed playlist YAMLs, tests; report `_13` partial. **2026-07-28 (`_26`): WHITE=AMBER lane-matching pass landed + deployed across all 40 `rgbwau()` patterns incl. the 60–65 drafts** — W and A now always carry the same exact value (matched W+A = the ship's warm white; pure-W is cold, pure-A is yellow), convention documented at `docs/MARSIN_ENGINE_PATTERNS.md` §5.1 and enforced by an auto-discovering byte-equality test. Animation logic untouched. **2026-07-28 (`_32`): PARAMETER TRUTH SWEEP — every declared slider on every pattern verified against what its NAME claims.** New offline harness `marsin_engine/tools/param_truth/` loads each pattern into the engine's own WASM VM, sweeps each `slider*` across 5 points, measures what actually changed in the light, and classifies TRUE / DEAD / WRONG / WEAK / UNKNOWN_CLAIM against documented absolute thresholds. **817 params across 125 patterns in 183 s** (sharded across cores; fully offline, no port touched): **TRUE 548 (67 %) · DEAD 170 · WRONG 39 · UNKNOWN_CLAIM 35 · WEAK 25**. **The headline is that 137 of the 170 DEAD are a MODEL problem, not a pattern problem** — they are white/blinder controls gated behind `sectionId == 2`, and all 981 titanic pixels report `sectionId 0` (corroborates `_33` from the model side), so they measure TRUE on `test_bench` and byte-identical on the ship. Roughly **one in six pattern parameters is inert on the actual ship until R8 lands the section mapping**, including most audience-blinder work — a visibility risk on the mission-critical goal. Real pattern-side punch-list is **73 params (8.9 %)**: 25 hard-dead, 9 buried by a shipped default, 39 wrong. Confirmed in source: `22_abyssal_sway_garden/sliderBaseDarkness` is **inverted** (`glowFloor = 0.04 + baseDarkness*0.08` — "darkness" ADDS light, luma rises 0.0304→0.0405 monotonically); `13_sparkle/sliderAmberGlint` is **dead as a direct consequence of the `_26` lane-match pass** (`a = glint*amberGlint*warm` then unconditionally overwritten by `a = clamp01(w)`), which also explains the WRONG `sliderWhiteWarmth` rows; `05_orbital_attractor_field` + `17_rolling_color_dunes` blinder pairs are wired but gated behind `kick`, which ships at 0 (whiteKick sweep delta 0 at kick=0, **30 578** at kick=0.5). CI smoke `tests/patterns/param_truth_smoke.test.js` (8 tests, 6 s) guards the machinery, not a verdict census. **No pattern file touched** — findings are the curator's to fix | Resume the parked agent (finish validation → rosters → deploy) when Sina schedules the tuning session. **At the re-tune, eyeball the 7 flagged patterns** whose amber did real work beyond a warm tint and so visibly changed: `17_rolling_color_dunes`, `13_sparkle` (strongest), `00_golden_hour_wash`, `07_shimmer`, `11_bioluminescence`, `04_beat_folded_helix`, `05_orbital_attractor_field` | Sina (art) + parked agent |
| R3 | **Show program** — ambient default, scheduled party moments, detection-triggered party playlist, themed nights | Machinery DONE (R1 timeline); DRAFT content on disk (ambient/party trio deployed via R1; themed drafts parked with R2) | Sina: party-moment schedule (§Open 7) + theme culling (§Open 9); then author the week plan YAML | agent proposal → Sina curates |
| R4a | **Smokestack rope LEDs** — physical test | BLOCKED ON HARDWARE ACCESS | Sina schedules bench time; agent preps a test checklist (mapping, universes, patterns to run) | Sina + agent checklist |
| R4b | **TE sign** — physical test (still being assembled) | BLOCKED ON ASSEMBLY | Same checklist treatment; test_bench mapping fix already diagnosed (`20260725_4`) and awaiting mapping decision | Sina + agent checklist |
| R5 | **Autonomy & robustness** — boot, supervision, recovery, offline | STRONG BASE (deploy pipeline + supervisor + schtasks live on titanic-ext). **Log disk-fill risk CLOSED (`_17`, deployed)**: sACN + Art-Net send errors are now throttled per destination (`marsin_engine/lib/send_error_throttle.js`) — first error + error-class changes log immediately, then one summary per destination per 30 s with the outage duration and suppressed count, plus a RECOVERY line. Live: 5 240 failed sends in 65 s → **6 lines** (was 5 240; the 88 MB/4 h log that prompted this). **VSN1 deploy-overflow + libuv-abort DIAGNOSED (`_30`, 2026-07-28):** the 5960>909 "Shorten the Lua" error is a **CRLF line-endings bug** — `grid_serial.cjs stripLineComments` regex can't strip comments from CRLF lines (working-tree `.lua` templates are CRLF via `core.autocrlf=true`, no `.gitattributes`; July-15 dump proves the same templates compiled to 904/909 with LF), so comments ride into the single-line action string; 6 of 9 templates blow the budget, and a surviving `--` comment would comment out the whole flashed script while passing checkSyntax. The libuv `async.c:94` abort is **NOT the deploy child** (21/21 clean exits incl. exact engine invocation) and **not causally linked** to the overflow (engine survived it live 07-25) — it's a process-teardown race (engine-exit / launcher execFileSync family) whose trigger environment is the constant doomed-deploy churn (deploy-on-boot + every effect change). Engine has NO attach detection at all — deploys are spawned blind. **FIXED + TESTED (`_31`, 2026-07-28) — steps 1–10 + 12 of the `_30` plan landed; step 11 deferred for sign-off.** The overflow is **closed at the root**: `stripLineComments` now splits on `/\r?\n/`, and all nine templates compile to the July-15 known-good sizes (encoder INIT **904/909**, key INIT 871, lcd_draw 573, system 626) — Fable's own `measure_templates.cjs` went from **6 templates OVER** to zero. A **fail-loud comment-survival guard** makes the silent dead-Lua hazard unshippable, and the reason it was needed is now an assertion, not a claim: on a script whose whole body lands inside a surviving comment, `GridScript.checkSyntax()` returns **`true`**. `.gitattributes` (`*.lua text eol=lf`) kills the drift class. **Attach state is now first-class**: `attached\|detached\|unknown`, resolved by a short-lived `probe_vsn1.cjs` child (exit 0/3/1; enumerates ports, never opens one) at boot, at every flush drain and at `POST /global-effects/deploy` — serial stays OUT of the engine process, crash isolation preserved. `detached` clears pendingPages, sets `lastResult:'skipped-detached'`, logs **exactly one** line per transition and spawns **no** deploy child; `unknown` deliberately still attempts (a broken probe must not silently disable deploys — P0); reattach re-queues page 0 once; a config-gated-OFF engine spawns no child of any kind. CaptainPad's banner gained a `kind:'error'\|'offline'` union so "no controller on the desk" renders neutral, never red. Teardown hygiene: the discarded `fs.watch` handle is kept + `close()`d in `shutdown()`, and `dispose()` kills/unrefs any in-flight CLI child — shrinking the live-handle set that is the ONLY window the libuv `async.c:94` assert is reachable in (hygiene, **not** a proven abort fix — the race is still unpinned; the doomed-deploy churn that maximised its exposure is gone). **Proof:** 23 new tests (7 template-budget incl. LF/CRLF/on-disk byte-identity + a printed headroom report flagging encoder INIT at **5 chars** of margin; 16 attach/survival incl. child hard-abort `0xC0000409` mid-drain, 6 KB stderr, spawn `error`, device vanishing mid-burst, all with an `unhandledRejection` trap asserted empty); engine `npm test` **2324→2347 tests, 8→8 fails = the SAME 8, all pre-existing** (7 env assertion fails in 3 untouched files + 1 Node test-runner IPC artifact, disproven three ways incl. a serial run of effects+vsn1 at **465/465**); CaptainPad **889 pass** + tsc clean; and a real-child end-to-end run (real `spawn`, real probe, device unplugged) giving 1 log line, 4 probe children and **0 deploy-CLI spawns** where the old code would have burned 4 doomed compiles and painted 4 red banners | **(a) Sina — ONE git command:** `git add --renormalize .` (the 9 templates are still CRLF in the tree; harmless now by construction, but this is what stops the drift). **(b) Sina — step 11 sign-off (`_30` §7 Q4):** bounded launcher auto-restart on abort-class engine exits (3/134/3221226505, >2 in 10 min ⇒ teardown as today). `launcher.js` is UNTOUCHED; nothing else depends on it — it is the belt to `_31`'s braces, the one guarantee this change does NOT provide (an *unpinned* teardown race can still end the night). **(c) `_30` §7 Q1–Q3 stay useful only if the abort RECURS** — the trigger environment is gone, so a recurrence is now the real signal | Sina (renormalize + Q4 sign-off) |
| R6 | **Operator surface** — CaptainPad live-performance UI | Rounds 1+2 SHIPPED (`20260725_11`): 6 plan items + master-fader off-screen fix, 1-row landscape title bar, perf rows −30 %, lock toast; vitest 798 | (a) Sina answers R2-4 (extra row = AUDIO meters or BPM-SYNC banner?); (b) swap-wedge pipeline **CLOSED**: debug (`_14`) → fix + deploy (`_15`) → **validation PASS (`_16`)** — adversarial: live morph-kickoff + deck-remove cancels heal in 2-4 ms, REAL socket sever mid-fade healed by watchdog at 8 060 ms (window 8 000), 12 rounds of swap-over-swap + interleaved cancels with **zero stale-unlock**, S1 22.8-47.2 ms, tsc clean, vitest 803, engine 8 fails = 8 known-env (`_15`'s "7" undercounted a pre-existing flaky worker-IPC fail, unrelated to the fix), and the fix reproduced **live on titanic-ext** (heal 8 ms); the one latent fragility `_16` flagged is now **hardened + deployed (`_17`)** — `deckSwapComplete` only releases the lock when its `transitionId` matches the stored `deckSwapStarted` id (both heal paths kept: no id stored, or no id on the complete; watchdog still the backstop), vitest 809; 5 Hz viz re-render (69 % main-thread drag) deliberately NOT fixed — separate follow-up; (d) **surface-trim + party-handling wave SHIPPED (`20260725_18`)**: Monitor tab **removed** entirely (screen + route + sidebar entry + its dead `desktopcomputer` icon mapping); Audio tab gained an **OPEN COMPANION** button (URL derived from the effective api_base with the port swapped to the companion's 6966 → `http://10.x.x.151:6966` on Sina's iPad, never 127.0.0.1) and keeps ONLY that (detection tuning lives in the companion); the **PARTY MODE handling card now lives on the TIMELINE tab** per the operator's division of concerns — hard enable/disable, trigger-playlist picker, an always-on SUSTAIN stepper, and **two session-length modes** — duration ON = fixed `durationMin`; duration OFF = follow-the-music (ends when the party signal drops; the release IS the companion's `offConfirmMs`, so the row is a hint that deep-links to the Audio Companion, not a second sustain editor), with COOLDOWN forced off + greyed in that mode per the operator rule; status line reads armed · disabled · no-plan · in-session · cooldown; built against the engine's `GET/PUT /party-config` contract (`utils/party_api.ts`, pure helpers + 35 vitest cases), every edit coalesced into ONE debounced PUT (6 mashed taps → 1 write), edits KEPT with a RETRY when the engine drops mid-edit, missing contract fields rejected by name, 400s printed verbatim; **the engine's `/party-config` landed LIVE and is now consumed**: six-value `effectiveState` (incl. a distinct MANUAL pill and an OUT OF WINDOW state that names the festival window), live “ends in m:ss” / “cooling down m:ss” readouts from `sessionEndsAtMs` / `cooldownRemainingSec`, and greying driven by the engine's `effectiveCooldownEnabled`; tsc clean, vitest **867** (809 + 58 new); **no deploy needed** (titanic-ext runs `profile: prod` = sim + engine only; CaptainPad is Metro-served from Sina's laptop and `dist/` is gitignored, so the removal + cards hot-reload to his iPad); **live proof DONE against titanic-ext** (404 IOU closed): real GET renders 14 playlists + OUT OF WINDOW, a stepper tap round-tripped `{"cooldownSec":180}` through the real engine and back to 120 (plus a direct 120→121→120), and duration-OFF greyed the cooldown row from the engine's own effective flags — titanic-ext restored to its exact starting values; **(e) ADVERSARIAL VALIDATION of the card (`_20`) — ONE HIGH DEFECT (D6)**: driven live on a fresh `expo export` dist on **:7167** (the operator's :6967 Metro never touched) against a real engine walking a real session. Honest where it polls — "ends in 4:33 · **mood calm**" during a fixed session correctly riding out a signal drop, "Cooling down 5:58" ticking down, DISABLED mirrored from another surface. **But the card only refreshes while `cfg.effectiveState ∈ {in_session, cooldown}` — a value that can only become live via the very poll it gates — and NOTHING in CaptainPad subscribes to the `partyConfig` WS message the engine broadcasts on every PUT and replays on connect.** Proven live: the engine sat `in_session` (ends in 295 s) while the card read "**ARMED** — Waiting for sustained party audio" for 24 s and through a `focus` event; only a full page reload corrected it. Mirror case: after a gate flip from another surface the card renders an **ENABLED toggle over a DISABLED pill**, permanently. On playa that means the iPad says "waiting for party audio" while the rig is visibly in a party session, with no in-app way to fix it. Fix: add the `partyConfig` WS listener and/or derive the live phase from `timelineState` (broadcast every tick, already carries `party` + `activeCue`). Screenshots `~/tmp/party_timeline_validation/captainpadB_party_*.png`; vitest **867** / tsc clean confirmed independently. **(f) D6 FIXED (`_22`, display-only)**: `PartyModeSection` now subscribes to the engine's `partyConfig` WS broadcast through `engineEvents` + `parsePartyConfig` (a malformed broadcast is a loud banner, never a half-populated card), and the 5 s `/party-config` re-read runs unconditionally while the card is MOUNTED instead of being gated on the very `effectiveState` it would discover; the 1 s countdown clock stays gated on a live phase. Re-proved live on a fresh `:7167` dist against a real engine (the operator's :6967 Metro untouched): the card flipped to **IN SESSION · ends in 4:56** with NO reload where it used to sit on ARMED for 24 s, and a gate flip from another surface now lands as DISABLED/DISABLED then ARMED/ENABLED instead of the permanent pill-vs-toggle contradiction. tsc clean, vitest **869** (867 + 2 broadcast-parse cases). **(g) REVALIDATED (`_23`, final gate)**: re-proved on a **freshly rebuilt** `expo export` dist on `:7167` (operator's `:6967` Metro untouched) against a real engine — the card flipped to **IN SESSION · ends in 4:56 with NO reload**, reported "ends in 4:33 · mood calm" honestly while a fixed session rode a signal drop, and a gate flip from another surface landed DISABLED/DISABLED then **ARMED/ENABLED** — the permanent pill-vs-toggle contradiction is gone. Note the in-session flip is carried by the now-unconditional 5 s HTTP poll **alone** (the engine does not broadcast `partyConfig` on a session transition), which is exactly the "card under a flaky WS" case the fixer asked to be checked. The two React #418 page errors are byte-identical to `_20`/`_22` (pre-existing hydration warning). tsc clean, vitest **869**, swap-wedge watchdog 11/11; **(h) STUDIO tab text editor DEBUGGED (`_27`, Fable) — operator: "cursor is broken, cannot go to a position to type"**: the editor is a transparent `<textarea>` overlaid on a tokenized highlight `<Text>` (the sound react-simple-code-editor pattern) with 4 broken details, all measured live on a fresh `:7167` dist: (D1) **caret literally invisible** — RNW 0.21 drops `selectionColor` on web so caret-color inherits the input's `rgba(255,255,255,0)`; (D2) the textarea's internal scrollbar steals ~15px of wrap width vs the highlight → soft-wrap divergence of **+6 rows @1280x800 / +41 rows @820x1180** on a 17KB pattern → taps land up to 41 lines away; (D3) caret near EOF internally scrolls the invisible textarea (`scrollTop 120`) while the highlight stays → the WHOLE editor permanently offset; (D4) 53–88ms/keystroke measured (whole-file retokenize ×2 layers) → est. 150–350ms on iPad; (D5) KeyboardAvoidingView is a **no-op in RNW** — iPad keyboard covers the editor; plus no caret-follow (D6) and Tab exits the field (D8). Verified NOT broken: caret preservation, undo, save path. **Verdict: PATCH not rebuild** — 7-step verbatim plan in `_27` (caretColor, overflow:hidden geometry lock, per-line memoized highlight, visualViewport keyboard handling, mirror-based caret-follow, Tab handler, tap-preview-to-edit) + full 3-viewport validation recipe. **(i) STUDIO editor FIXED (`_28`, all 7 steps + 2 extra geometry bugs)**: caret now paints `rgb(0,218,243)`; the geometry lock holds at all 3 viewports with **`scrollHeight − highlightHeight` = 0 px** and `offsetWidth == clientWidth`, so tap-to-position lands on the **exact character** — 0 chars off at mid-file, at the deep `rgbwau(` token, and (D3's trap) at EOF *after* a deep-scroll trip, with `ta.scrollTop` still 0; keystroke median **88.4 → 24.8 ms** desktop (74.6 → 23.9 portrait, 53.3 → 24.5 landscape) via one shared per-line `React.memo` highlighter + not rendering the covered main-pane preview; Tab inserts 2 spaces and Ctrl+Z still undoes it (execCommand keeps the native undo stack); the outer scroller now follows the caret; the modal root tracks `visualViewport.height` so the header + editor stay above the iPad keyboard; tapping the preview opens the editor. **Two bugs `_27` couldn't see, found by asserting the invariants:** pattern files are **CRLF** and a textarea's `.value` strips CR — the highlight layer carried **312 extra `\r`** (17,564 vs 17,252 chars), which is why taps were **−304 chars** off even after the wrap-width fix; and a textarea paints an empty final row for a trailing newline that a pre-wrap block does not (20 px = one row of residual internal scroll). Both closed (`splitLines` normalizes exactly like the textarea; a zero-width probe supplies the trailing row) — the saved bytes are unchanged. Honest gap: the <16 ms target is **not** met (residual is Chrome laying out the 8.8k-px block + the controlled-value round trip, not tokenizing); `useDeferredValue` is the documented next lever if the operator still finds the iPad mushy. Save/RUN untouched and deliberately NOT pressed (only engine on the net is his live :6968). tsc clean, vitest **886** (869 + 17). Needs his physical iPad: D9 smart punctuation, real touch/magnifier caret drag, real keyboard geometry, felt Safari latency, one SAVE roundtrip | done |
| R7 | **LED strand tuning & mapping** — color/white fidelity + vibrancy on the strands, controller onboarding/mapping health (operator 2026-07-28: strands fully mapped and working; "I need vibrant colors on DMX which is good now, and LEDs both together") | Color/white review DONE (cross-repo trace; findings + ranked fix plan live at `~/tmp/led_color_translation_review.md` — **kept OUT of this public repo by operator rule**; only BM-side facts here): strand pixels emit 4-byte RGBW from `simulation/src/dmx/sacn_mapper.js:207-242`, AMBER+UV lanes dropped for strands while the sim preview mixes amber in (preview lies), no gamma in the strand path, engine OKLCH work exonerated. **Software fix wave LANDED (`_25`, code + tests; deploy + gamma push permission-blocked)**: (1) clip-proof TRUE-RGBW emission, jointly pre-scaled so the LED controller's white processing can never clip — binding format contract, renders correctly on current AND future controller builds (half-updated fleet never looks broken); (2) amber folded into strand RGB (UV stays dropped, no emitter); (3) gamma moved to the CONTROLLER's own configurable correction via HTTP config push (per-controller config backed up to ~/tmp first, read-back verified, revert documented; gamma lives in exactly ONE place); (4) sim preview computes strand color from exact wire bytes + modeled controller behavior (isolated behind one function; per-controller flip later = one config line). DMX par path byte-untouched. **Controller-side white pass-through change**: assessed decision-grade (surgical ~60-100 LOC, low-med risk; NO remote update path — physical USB per unit, 10 of 15 units benefit; payoff 1.7-2.5× luminous white on partial-white content, ~1.25× full-field under the power cap; verdict MODERATE after software fixes). Implementation agent stopped for the operator's per-output question (answered: change is per-output in the RGBW driver only; RGB-chip outputs byte-identical; mixed types per controller safe by per-output driver selection). **Controller-side (firmware) change: PAUSED by operator (2026-07-28)** — "do not start firmware update yet, it's looking better now and I think it could be good to use like this"; software-side gamma + white handling continue and get refined (`_25` wave). The firmware assessment + design stay on file (~/tmp review addendum) if he ever wants the extra white punch; no agent touches it without an explicit go. **OPERATOR VERDICT (2026-07-28 later): RGBWAU→LED color path ACCEPTED — colored patterns look good. WHITE-pattern residual issues PAUSED too** ("pause the white issue for now") — the diagnosed composite-ceiling mechanism, P1 soft-knee plan, headroom-knob option, and the LED-0→0.40 hand test all stay ready in `~/tmp/led_white_resolution_debug.md`; resume only on explicit ask. **Gamma is now an OPERATOR control (`_29`, LANDED 2026-07-28):** every LED controller card in the sim's Controllers panel has editable r/g/b/w gamma fields (scene mirror → preview follows immediately) + a per-card **⬆ Push gamma**, and the LED group header has **⬆ Push gamma to all** — sequential, one named result per controller (ok/failed/unreachable/skipped), no silent partial fleet. Each push = full-config backup → gamma-only write → read-back verify → mirror the VERIFIED values + stamp `device.lastGammaPush`; a failure leaves that controller's mirror untouched. Browser → save-server (`POST /led/gamma-push`) → controller; the CLI tool and the route share ONE implementation (`simulation/server/led_gamma_service.cjs`). Live-proved on the bench controller (2.2→2.3→2.2, `applied`, no reboot). Controller web-UI gamma version check CLOSED (`_64`, GET-only): the `.60`'s flashed web console serves **zero** gamma references — its UI image predates the firmware's "Color Curves" card, while its core reports `capabilitiesExt.gammaRgbw: true` and config `version 3.1.0`; the sim UI is the supported path, and putting the card on the device is a private-repo reflash (operator-gated). **Gamma UI upgrade (`_64` design LANDED, `_65` implementation LANDED, operator order 2026-07-30 "instead of plain textboxes which I don't understand at all"):** the four r/g/b/w number boxes are now firmware-style **sliders (1.00–3.00, step 0.05) + a live inline-SVG curve plot** (all four y = x^γ overlaid, quarter grid, dashed identity reference, 1/255 video clamp, dashed ghost of the last hardware-verified curve on drift) + **Link RGB** + presets **Off / 2.2 sRGB / Punchy** (W held at 1.0 — our doctrine, unlike the firmware's presets). UI-only: validation, mirror, backup→gamma-only-write→verify all unchanged; no bridge notify needed. Filed follow-up: a verified gamma push still persists the mirror in memory only (autoSave off), so a reload reverts the mirror while the hardware keeps the curve — fix rides `_61`'s persist step in a later slice. **2026-07-28 (`_26`): the pattern side now agrees with the strand path** — every pattern emits W and A matched, so a white cue lands the same colour temperature on the DMX pars (matched W+A = warm white) and on the strands (which fold amber into RGB per `_25`). Deployed to titanic-ext (preflight: zero remote-newer files) **before** the operator's 2026-07-28 stand-down on remote deploys — **no agent deploys to titanic-ext again until Sina says so**. **2026-07-30 (`_58`): LEDs LIVE on the .60 + push/save workflow root-caused.** Push writes ONLY the device; the strands' feed (bridge relay routes from patches.yaml + engine model send set) moves ONLY on a scene save, and autoSave is off — so his push-then-full-save two-step was genuinely required, and the day-long darkness = the unbound card (`_56`) suppressing strand-patch projection on every earlier save until the push auto-bound it. Controller-pane Save Configuration already IS the identical full save. Defects filed with fix slices S1–S5 (push completes persist+notify loop with per-step honest dialog; registry-aware plan gate — the push auto-extended device output 3 onto U23, LeftFrontDeck's DMX universe, a live-verified cross-controller collision, inert but armed; bridge runtime universe subscription — receiver list is boot-frozen and the sacn package drops unsubscribed universes silently; notify ordering + loudness). All sim-side, no engine changes; acceptance = live re-run of his exact sequence, push-only ⇒ LEDs follow | **(a) Sina: tune gamma straight from the sim — Controllers panel → LED card → r/g/b/w fields → ⬆ Push gamma (or ⬆ Push gamma to all for the fleet); backup + read-back verify + scene-mirror sync are automatic (restart `npm start` once so the save-server serves the new route; CLI fallback: `node simulation/agent_tools/led_gamma_push.cjs --host <ip>`); (b) run the blocked `deploy.py deploy --machine titanic-ext --scene test_bench` after confirming the 20-px-per-strand model is intended; (c) then eyeball the real strands on a white/warm pattern and call it.** Open follow-ups: measure the strands' white-emitter colour temperature (preview assumes neutral), reconcile the engine's LED controller host with the scene's, PSU/power-cap audit for the long RGB runs | Sina (eyes) + agents |
| R9 | **Sim render performance on the operator's box** | **DIAGNOSED — NOT a code regression (`_38`, 2026-07-28)**: the reported "10 FPS at the titanic sacn_in/full URL" is the sim rendering on the laptop's **Intel UHD iGPU** instead of the RTX 4090. Exact numeric repro: Intel-pinned Chrome = 20 FPS windowed / **10.0 FPS** at fullscreen-scale canvas; the SAME URL on the 4090 = **59.9 FPS** across a 9-row bisect (WebGL+WebGPU, hi-DPI, gradient, 110 s sustain, synthetic 24-universe×40 Hz sACN influx). Object census healthy (1,515 objects, 267 InstancedMesh — the `20260724_6` instancing intact; drawCalls 3,427≈baseline). Windows has NO per-app GPU preference for Chrome, so adapter choice drifts with power/driver/window state; `powerPreference:"high-performance"` (already set, main.js:90) is advisory and can't rescue it. Fix plan in `_38` §4: adapter logging + loud integrated-GPU banner + sustained-low-FPS console.error naming the adapter + ops-doc rule; side finding: engine sACN never reaches the :6971 bridge (chip filed). **VISIBILITY LAYER LANDED (`_39`, 2026-07-28) — steps 1-4 done, zero rendering changes:** every page now sets `window.__gpuAdapter = { renderer, integrated, detectionFailed }` at boot (WebGL2 `WEBGL_debug_renderer_info` probe / WebGPU `adapter.info`, probe context released) and logs one line; an integrated adapter — or one the browser refuses to name, which is its own loud state, never assumed healthy — raises a red `#gpu-adapter-warning` banner naming the GPU **and** the Windows remedy verbatim, plus a `console.error`; and a fire-once `[LowFPS]` `console.error` after **10 consecutive seconds under 20 FPS** names the adapter too, which is the one signal that also catches the RIGHT adapter under contention (leftover probe windows, extra sim tabs). No auto-fallback of any kind (P0): no backend switch, no profile downgrade — the sim renders exactly as before and says what is wrong. **Proved live on BOTH adapters** of the operator's box via `--use-adapter-luid` (his stack never restarted, both probe browsers closed): dGPU = **59.9 FPS, no banner, `(discrete)` log**; Intel-pinned = **15 FPS, banner visible naming `Intel(R) UHD Graphics`, boot `console.error`, and `[LowFPS] 16 FPS — under 20 FPS for 10 consecutive seconds …`**; screenshots show the identical scene either way. Sim suite **698 → 721 / 0 fail** (23 new tests). Ops rule wired into `.agent/ops/sim_auto_checks.md` ("GPU Adapter Check" + done-bullet: an FPS number without `window.__gpuAdapter.renderer` is not evidence, `integrated: true` invalidates the measurement) and `.agent/skills/see_the_world.md`. Honest gaps in `_39` §5: the classifier is the plan's regex verbatim, so SwiftShader software rendering is NOT banner-flagged (the low-FPS line still fires) and a discrete Intel Arc would be false-flagged; exactly 20 FPS does not trip the escalation (`<20` strict, banner still shows); the message fires once per page load; the adapter is read once at boot. **2D PIXEL MAP LAYOUT TWEAKS LANDED (`_40`, operator-requested, display-only):** the two 10-par chimney rings no longer sit stranded at the right edge of the Top-Down view — the shipped `top_down` default is now **ONE `spatial` panel** carrying bars + strands + both chimney groups, so `expandPanel`'s whole-panel TRUE world projection puts each ring exactly where it physically is, **at the centre of the strand fan it crowns** (par extents are strictly inside the strand extents, so the fit box and everything else on the view are unchanged). The old `weight: 1` `radial` "Smoke Stacks" panel — which re-normalised the pars into its own box and is what threw them out to the right — is **removed**; that also kills the red *"Panel 'stacks': no fixtures match its selectors"* banner that ate a quarter of the pane on every non-titanic scene. Deliberately **not** a per-fixture 2D placement override: `spatial` ignores `view.placements` by design, so an override would have meant demoting the panel to an editable layout and hand-placing 20 pars — hard-coding a copy of a truth the projection already computes. One knob needed: a **per-view `typeStyles`** entry shrinks `UkingPar` to 13 on `top_down` only (at whole-ship scale the shipped 24-unit disc fused the ring into a solid donut); every other view keeps the full-size par. Second operator ask done in the same pass: `TYPE_STYLES.ShehdsBar` **13 → 17** (+31 % linear, uniform so bars read thicker at any rotation, in design units so it scales with zoom) — no other glyph type touched. Verified live on the operator's `:6969` as a browser client only (fresh puppeteer browser per run, closed after; his stack never restarted) on the **RTX 4090** adapter, `integrated: false`: before/after on titanic Top-Down + test_bench Top-Down + a titanic Front sanity shot, in `~/tmp/pixel_map_2d_tweaks/`. Sim suite **721/721** immediately after the change. **Flagged, NOT from this change:** a later run read 719/2 — opening the `test_bench` scene in the sim re-exports `models/test_bench.js`, which surfaced a **pre-existing sId/fId collision** in the uncommitted test_bench scene (the two LED strands hold `sectionId 5/6, fixtureId 11/12`, the ids `patches.yaml` still gives TE Sign V3 A/B → exporter renumbers the sign to sId 7 / fId 13,14 → `drift/metadata_drift` ×2). Left unrepaired on purpose: which ids win is an operator mapping call (R8 / `_34`), the model file also carries uncommitted operator work, and the codex forbids hiding a side effect | **(a) Sina, one-time — the ONLY thing still open on R9:** Windows Settings → System → Display → Graphics → add `chrome.exe` → **High performance** → restart Chrome → confirm `chrome://gpu` reads `GPU0 … NVIDIA … *ACTIVE*` (instant 10→60; this box has no per-app entry today, which is why the adapter drifts). Also avoid battery-saver while running the sim | Sina (setting) |
| R8 | **Titanic scene output mapping + bench section** — full pixel→controller/universe/section/view mapping so the pattern audit sees live sacn_in data; test_bench as a section of the titanic scene for real-hardware sanity checks | **PLANNED (`_33`)** — investigation done: scene geometrically complete, `controllers: []` is the whole gap (model exports 981/981 `patch:null` → engine emits nothing); exporter/auto-patch/sections/views machinery all exists; pre-req sId/fId collision bug (`_4`); NO scene↔model validator exists; no same-scene engine reload path. 9-step/3-phase plan: Phase A = 4 parallel slices (sId/fId fix, parity validator, exit-75 same-scene reload + curator runbook, bench-section sync tool + `0.0.0.0` placeholder refusal); Phase B = mapping authoring in the sim UI (placeholder IPs unblock the FULL sim audit before wiring facts) + bench block integration; Phase C = full-stack E2E + placeholder retirement (`--strict` validator = hardware gate). Operator inputs O1–O9 in `_33` §2 — none block Phase A. **Phase A slice 3 (same-scene reload) LANDED (`_36`)**: `POST /scene/reload {"scene":"<active>"}` restarts the running engine on its CURRENT model through the existing exit-75 `requestSceneSwitch` path — same ports, same argv, one engine — closing the gap that a pixel-count change (e.g. adding the `TB ` bench block, ~981 → ~1,147 px) refuses hot reload and `POST /scene` same-scene is a no-op. Deliberate by construction: the caller must NAME the active scene (mismatch = 409, never an implicit switch), performance mode blocks it (409), missing model 404s, traversal 400s — every refusal loud with a machine-readable `code` and zero state change; the scene-bounce workaround (two restarts) is retired. Runbook for the operator AND the curator: `.agent/ops/engine_model_refresh.md` (which case you are in, the validator gate, poll-until-back, STOP-and-report if it doesn't; hard limits: never a second engine, never free 6966-6972/5568, never kill an engine directly, never restart during a show). 18 new tests (11 pure guard-matrix + 7 against a REAL engine on an OS-assigned free port with sACN black-holed: refusals leave it running, accepted reload acks then exits 75 with the same-scene handoff, no orphan); engine suite 2373 tests / 8 known-env failures (baseline unchanged). Stale `now.md` "restart after any universe change" note corrected — the real trigger is a pixel-count change. **Phase A slice 1 (sId/fId collision) LANDED (`_34`)**: DMX fixtures and LED strands share ONE section/fixture id space, but `projectOntoConfigs` took its max over DMX configs only, so a DMX fixture added after the strands were numbered was minted straight onto a strand id — the shipped test_bench model has 40 `TE Sign V3 A` pixels and 20 `LED_0` pixels both stamped `sId 5, fId 11`, so `/dimmer-groups` returns a duplicate 5 and the Dimmer Rack's two faders drive one section. Now floors over the same DMX ∪ LED union `assignLedStrandMetadata` uses (`ledStrands` is a REQUIRED arg — a silent `[]` default would re-open the bug, so a non-array throws) plus a one-time, loudly-reported, idempotent repair of ids the old pass already baked in; the DMX side yields because only it could ever have minted blind. Measured across all seven scenes with a `patches.yaml`: **only test_bench changes** (`TE Sign V3 A/B sId 5→7, fId 11→13 / 12→14`; LED_0 keeps 5/11, LED_1 keeps 6/12) — studio, studiodj, studio_top_loft, summer_camp_dome, summer_camp_logsville and titanic export identical models. Sim suite 591 → 601 pass / 0 fail; all 10 new tests (6 unit + a new cross-module `section_fixture_id_space.test.js` covering the seam neither existing file owned) fail against a pre-fix copy of the module. Consumer audit: no pattern is affected (every `sectionId` test in `patterns/`/`og_patterns/` compares against 0–3 only) and every engine/CaptainPad consumer re-derives ids from the model — the two exceptions are the raw numeric `dimmers` maps in `marsin_engine/states/test_bench/globals_state.yaml` and its `performance-preshow` snapshot (both currently `1.0`, so no behaviour change, but stale once the ids move). NOT re-exported: the model generator is the browser exporter (no headless path), so ONE operator sim-save on test_bench applies the repair to `patches.yaml` and the three model files atomically. **Phase A slice 2 (parity validator) LANDED (`_35`)**: `node simulation/tools/scene_model_parity.cjs <scene> [--strict]` — the acceptance gate for the whole campaign, and the first thing in the repo that checks a generated model against the scene it came from (the engine validates only groupBits↔groups at load; nothing caught a stale model, a duplicate DMX address, an unmapped fixture or an id collision). Eight check families, every finding located and actionable: coverage (the pixel roster PREDICTED exactly from the scene + fixture-definition YAMLs — name, group, `localIndex`, channel map, `pixelCount`), patch truth (model patch == `patches.yaml`; the LED no-straddle per-pixel walk, `end*` and `segments`; stride/order/`whiteMode`/`ledWire` vs the owning controller), address hygiene (1–512 with footprint, universe range, controller existence, orphan/duplicate chain entries, occupancy overlap, **unmapped fixture/strand = error**), metadata (nonzero `cId/sId/fId`, group↔section bijective, **no DMX/LED id collision** — the `_4`/`_34` regression guard), views (`views.yaml` ↔ model groups ↔ `.viewmasks.js` sidecar, bit hygiene), bench parity (a `TB ` block vs the test_bench source on invariant fields — slice 4's copy cannot drift), placeholder policy (`0.0.0.0` = info by default, **error under `--strict`** = the hardware gate; a sentinel without the `PLACEHOLDER` name marker, or a marked controller with a REAL ip, fail in both modes), and drift (`pixelCount`, effects sidecar, and `patches.yaml` re-derived from the `controllers.yaml` chains + `global_effects` pins — catching the hand-edit `_4` proved is futile but nothing detected). Deliberately imports NOTHING from `simulation/src/`: a gate that re-runs the code it audits agrees with the exporter about a wrong answer, and this one stayed runnable while the sibling slice rewrote `controller_registry.js` underneath it. Verdicts as committed — **test_bench FAIL (8 errors)**: 2 unmapped TE Sign fixtures (O5, sign still being assembled) + the 4 sId/fId collision findings, which stand until the operator's first sim-save re-exports slice 1's repair (**this validator is what proves that landed**); **titanic FAIL (92 errors, 100 under `--strict`)**: 84 unmapped fixtures + 8 unmapped strands and NOTHING else — coverage, patch truth, views and drift are all spotless on both scenes, independently confirming the titanic model is a fresh, complete, faithful 981-px export and the gap is purely electrical. Phase B authoring counts this down from 92 to 0. 52 tests (one mutation per check family asserting the SPECIFIC code, plus real-scene shape assertions that survive the campaign fixing scenes one at a time); sim suite 698 pass / 0 fail. Wired into `.agent/ops/sim_auto_checks.md` (new "Scene ↔ Model Parity Gate" section + done-bullet) and `.agent/ops/marsin_engine_auto_checks.md` (models are generated — never hand-edit). **Phase A slice 4 (bench-section sync + sentinel refusal) LANDED (`_37`)**: `node simulation/tools/bench_section_sync.cjs` derives the `TB `-prefixed bench block from the test_bench scene (single source of truth) — offline, idempotent (two runs byte-identical, 7,911 B, digest `3610e53583fd…`; negative zero normalized after a failing test showed the bench's `rotX: -0.0` can split the emitted bytes from the digest), **refusing rather than reconciling** with distinct exit codes: 2 = source self-contradiction (10 falsified checks — chain orphan, controllers↔patches address/universe/IP mismatch, orphan patch, double-chained fixture, ledCount ≠ pixelCount, segment sum, out-of-range address, no controllers; the real bench is clean on all), 4 = target collision (`TB ` squatter, a fixture on bench-reserved U1/U2/U10/U12, view-budget overflow), 3 = a hand-edited applied block (dotted diff paths, e.g. `controllers[0].ports[0].chain[0].at: derived=1 target=250`; dropped chain members and edited wire blocks caught too), 5 = `--strict` with placeholders. The design is a three-tier field split: INVARIANT (ip/type/protocol, port, universe, startAddress, chain ORDER + names + `at`, `led:` wire block, `device:` binding, fixtureType, pixel counts) is parity-enforced; TARGET-LOCAL (placement, colour, brightness) is seeded then operator-owned and never a failure; section/fixture/view/controller ids + `device.lastPush` are STRIPPED because the TARGET registry re-derives them — which is exactly what stops the bench's `sId 5/6, fId 11/12` (slice 1's collision) crossing into titanic. Block **NOT applied** per the step boundary — `--apply` refuses and points at step 6. Sentinel half, the plan's UNVERIFIED item, now verified and worse than assumed: the bridge never *sent* to `0.0.0.0`, it dropped it **silently** on one inline condition that also swallowed loopback, so dark hardware was indistinguishable from undeclared hardware; now classified `sentinel`/`missing`/`broadcast`/`loopback` with one named warning per (scene, universe, ip) naming the fixtures that asked, to console + monitor panel, refusal set deliberately tight (hostnames still route) — route counts identical and **zero** refusals across all seven patched scenes today. Cross-checked against slice 2 rather than merged into it (sibling file untouched): the derived block yields **0** bench-parity findings in `checkSceneModelParity` and a mutated address produces exactly the drift error this tool refuses; `compareBenchSection` is the stricter superset (adds `startAddress` + `device:` and dotted paths), so check 6 should delegate to `lib/bench_section.cjs` rather than keep two hand-synced definitions of "invariant". **Phase B blocker surfaced: titanic reaches 30/31 view bits once the block lands (23 group bits + 7 new), leaving ONE spare — step 5's named audit views need the same bits, so the 31-bit export ceiling must be re-planned BEFORE applying** (the tool reports the budget every run and refuses on overflow instead of letting the exporter throw later). +45 tests (39 new + 6 on `bridge_routing`, 10 → 16); sim suite 698 pass / 0 fail with all four slices interleaved. `sacn_bridge.js` edited but never executed — operator's live stack untouched, so a live bridge confirmation belongs to the Phase C smoke. **Generator swap/splits DESIGNED (`_41`, 2026-07-29)** — Phase B authoring aid per operator ask: `chainSplits` on a trace = ordered runs over path positions (4→5 / 3→2 / 1→1; start>end = reversed; exact cover of 1..count or LOUD refusal) that **renumber fixtures at generation time so number order = wire order** — retroactive fix for already-mapped generators (sticky addresses land on the wiring-true lights, zero chain surgery, prior art: studiodj's hand-split LeftSmokeStack chains) AND prospective (numeric-order add = wire order; per-split port targeting = contiguous number ranges). Swap button = the single full-reverse split, same mechanism. Zero registry/panel/exporter/engine changes — chains stay ordinary `{fixture, at}` so the `_35` validator reads the effect natively; one new `generator_splits` well-formedness check; count-change invalidation refused loudly, never silently reconciled. Field named `chainSplits` to dodge the reserved `trace.splits` int (`20260724_32` circle station-chains, S2 unwired). 12-step Opus plan in `_41` §7 (`_42` reserved); operator to ratify the renumbering semantic (§8). **IMPLEMENTED (`_42`, 2026-07-29) — 9 core steps done, 3 optional/operator-gated deferred.** `chainSplits` on a trace now renumbers fixtures at generation time so `<group> 1` is the first light on the CABLE; `⇄ Swap start/end` writes the single full-reverse split (one code path, and its label flips to `⇄ Restore path order`). New pure module `simulation/src/dmx/generator_chain_order.js`; the emission seam `emitInChainOrder` was moved INTO it so the generation tests exercise the shipping code rather than an oracle (the aim math above it is a diff-visible no-op — the push literal became a `pointData[i]` assignment with identical key order, so scene YAML stays byte-identical when splits are absent). Card gains a collapsed `⛓ Chain Order (wiring)` folder (status row, per-split From/To steppers, add/remove, Swap, amber mapped-fixture note) plus a card-level red `⚠ CHAIN SPLITS INVALID` badge so a boot skip is visible in the UI, not just the console. Refusals are loud everywhere and never repair: invalid splits refuse (re)generate BEFORE the undo push and the sweep (alert interactively, `console.error` + skip that trace at boot, saved rows left as-is), and a `Lights` count change that would invalidate the splits reverts the slider and KEEPS them. `+ Add split` / `− Remove last` are total — add halves the last split, remove merges back or deletes the field entirely (never `[]`, which is invalid, not "absent"). Validator gains `generator_splits/invalid_cover` (ERROR both modes, rule re-stated independently of `src/`); it contributes **zero** findings to every committed scene, since none carries `chainSplits` yet. **Sim suite 721 → 779 tests, 777 pass, 2 fail — the SAME two pre-existing `test_bench` `metadata_drift` failures (half-applied `_34` repair awaiting the operator's sim-save); 58 new tests, zero new failures.** Live-proved through the real GUI on `:6969` as a browser client only (his stack never restarted, probe browser closed) with a triple-guarded zero-scene-write harness `agent_tools/generator_splits_verify.cjs`: 9/9 green, 0 save requests, pristine restore verified, every `scenes/**` file still at its pre-session mtime; screenshots in `~/tmp/generator_splits/` inspected; adapter recorded (SwiftShader software GL, `integrated: false`) and **no FPS claimed**. **⚠ THE RENUMBERING SEMANTIC IS STILL UNRATIFIED (`_41` §8): a fixture's NUMBER now means chain position, not path position.** The confirm dialog says so verbatim ("a fixture NUMBER means its position in the physical daisy chain, NOT its position along the drawn path"); if Sina wants path-order numbering kept, `_41` §2 option (a) is the fallback and would be an emission-seam rewrite only. **CHAIN ORDER IS NOW VISIBLE IN THE 3D VIEW (`_43`, 2026-07-29)** — `_42` §6 deferred item (b), scoped up from sprite labels to the whole cable: with Show Generators on, each visible trace draws one coloured polyline per split in daisy-chain order, a comet ramp **and** an arrowhead per step for direction, dashed grey hops where the cable jumps between runs, and the post-renumber chain number over each light. The operator's 4→5 / 3→2 / 1 reads front-on as `5 · 4 · 3 · 1 · 2` in violet/magenta/magenta/cyan/cyan = `_41` §4's table drawn. New geometry-free plan module `simulation/src/dmx/chain_order_visual.js` (26 tests; concatenated run positions test-pinned to equal `expandChainOrder`, palette test-pinned not to collide with the editor's orange/yellow/green/red vocabulary); live-refreshed off the card's `refreshChainStatus` so steppers, add/remove and ⇄ Swap move it immediately; **invalid splits draw nothing** (the red card badge is the loud channel — a plausible chain that will never be generated is the forbidden fallback in picture form). Perf per memory `sim-perf-per-object-explosion` + the `_38` lingering-invisible finding: **built on show, disposed on hide**, never `visible=false`; ONE vertex-coloured `LineSegments` for all runs, ONE `InstancedMesh` for every arrowhead; drags rewrite buffers/instance matrices **in place** via hoisted scratch vectors (or re-parent when a drag handler replaces the group), so a pointer-move allocates nothing; label textures/materials cached and shared. Scene census on titanic: **1,487 → 1,577 objects** (+90 for 12 traces / 66 fixtures, dominated by the 66 label sprites — a real ~6 % bump *while the trace editor is open*, hence the new **⛓ Show Chain Order** switch in `📐 Group Generator`, on by default, runtime-only so it never reaches a scene file) and **exactly 0** whenever generators are hidden or that switch is off. Sim suite **779 → 805 / 802 pass / 3 fail**, +26 tests and zero new failures; parity verdicts unchanged (no scene or model touched). Live-proved on `:6969` as a browser client only, 10/10 green, 0 save requests attempted, pristine restore, `scenes/**` mtimes untouched, screenshots in `~/tmp/chain_viz/` inspected, adapter recorded (SwiftShader, `integrated: false`) and no FPS claimed. **⚠ Baseline correction: the pre-existing failure count is 3, not 2** — the third is a stale `models/titanic.js` (981 px vs the scene's 977, orphaning `Left/Right Top Chimney Generator 9`/`10`, plus an unpatched-marker gap on strand `Left_Front_Left`), the signature of the operator's uncommitted chimney 10→8 edit; it clears on the SAME operator sim-save the two `test_bench` failures are waiting on | Launch the four Phase A slices (multi-agent, `dev/` worktrees); schedule the Phase B authoring session with Sina (his sim UI + live stack); answer O1–O9 as known (esp. universe plan O3 + `.202`-vs-`.60` O7); **RATIFY (or reject) the `_42` renumbering semantic — the feature ships behind that one decision, and `_43`'s 3D overlay now shows you exactly what it does to a real generator before you decide**; **do the one sim-save that clears all 3 pre-existing suite failures** (the `_34` test_bench id repair + the stale titanic model); decide on the deferred `_42` §6 items, esp. (a) the group-level "+ gen (numeric order)" bulk-add, which needs a yes against the 2026-06-11 "no group-level add" ruling and is what cashes in the prospective half; file the `_42` §6 Notion cards (no Notion MCP in that session) | agents (A) + Sina (B inputs + ratification) |
| R10 | **Generator editor UX** — select freeze, laggy generator move/rotate, name↔chain-index parity, rename hygiene | **DIAGNOSED + PLANNED (`_44`, 20260725_44_generator_ux_fixes_plan.md)** — profiled on the operator's live :6969 (RTX 4090, `integrated: false`, triple-save-guarded browser client, zero scene writes): (1) select freeze = `main.js:240` wires the mutation handler to TransformControls' `change` (fires on ATTACH + gizmo hover, vendored TransformControls.js:117-124), so clicking a generator runs one full `generateGroupFromTrace` → `rebuildParLights` (82 fixtures destroyed/recreated) → shader recompiles — measured **2,719 ms rAF stall per select-click** (GUI-card select: 83-100 ms, 0 regenerates); fix = rewire to `objectChange`; (2) drag lag = the same regenerate runs **per pointermove tick** (`gui_builder.js:3596-3598`, dot-drag :3694): tick JS only ~24 ms but ~2.4 s frame stall each (paced drag **0.4 FPS**) — fix = COLD MOVE, regenerate ONCE on the existing `dragging-changed` release seam (main.js:205), strands included with the `_2` move-trail fix preserved by release-always-invalidates + a mandatory trail-regression test; (3) names already equal chain order in array/drawer/model/patches after `_42` — real gaps are a lexicographic sort in 2D pixel-map lanes ("Group 10" < "Group 2", pixel_map_layout.js:418-430), bare-number chain-viz labels, and an underselling renumber-confirm; (4) mapped group rename **silently unmaps every fixture** (casualty set = all N on disjoint name sets, gui_builder.js:4014-4019 → `unmapFixture` splice + misleading "channels freed" toast), old-name `__globalPatchTree` keys linger as phantoms, and `renameFixtureInChains` (controller_registry.js:1093) is DEAD CODE — the operator's clean 'Right SmokeStacks' rename was the lucky `controllers: []` case, and it silently orphaned the right chimney ring out of the default Top-Down 2D view (`pixel_map_view_defaults.js:24-27` still names the old group). **OPERATOR RULING (2026-07-29): rename → check the mapping and INVALIDATE it too, loudly** — default is fixture-by-fixture invalidation report + honestly-unmapped result (validator shows `unmapped`, never `drift`), no silent carry-over, no phantoms; the dead `renameFixtureInChains` becomes only an operator-gated OPT-IN "migrate addresses to new name" affordance. Plan: 3 Opus slices (1 select+cold-move ∥ 3 parity surfaces; 2 rename-hygiene after 1 — shared main.js/gui_builder.js), before/after TIMING gates (select <150 ms + 0 regenerates; drag FPS ≈ idle), suite bar 805/803/2 with zero new fails, parity CLI verdicts byte-unchanged. **Parity state after his saves: titanic stale-model suite fail CLEARED (979 px == scene 979; drift/coverage spotless; 90 known unmapped errs, was 92); the 2 test_bench metadata_drift fails remain** — the ONE test_bench sim-save is still owed. **SLICE 1 LANDED (`_45`, 2026-07-29) — select freeze DEAD, cold move IN.** `main.js` now listens to `objectChange` (never `change`), so `attach()`/hover can no longer run a mutation handler: a real 3D select-click costs **2,719 ms → 0-133 ms** max rAF gap across 6 runs with **0** batch invalidations and **0** regenerates (was 1 + 1). Generator drags defer the regenerate behind a new PURE dirty ledger `simulation/src/dmx/trace_regen_scheduler.js` and flush exactly ONCE on the existing `dragging-changed` release seam: per-tick handler JS **24.5 → 0.1 ms** (circle hitbox) and **23.7 → 0.4 ms** (line start-handle), the ~2.4-2.9 s per-tick frame stalls are **gone** (0-100 ms max gap for a whole 10-tick drag, 0 rebuilds), and a paced drag runs **0.4 FPS → 52-59 FPS = 1.00-1.03× idle FPS on the same adapter** (RTX 4090, `integrated: false`). Preview-dot drags and LED-strand handle drags get the same seam; **the `_2` move-trail fix is preserved by contract** — release ALWAYS invalidates, and the mandatory trail regression proves the cached batch render list equals a fresh `generatePixelMap()` (987/987 pixels, 0 stale coordinates) after both a generator drag and a strand drag. Operator-visible semantic, exactly as ratified (`_44` §5.1): mid-drag the generator ring/handles/dots/chain-viz track the cursor while the generated fixtures and the global dot overlay FREEZE, then catch up in one step on release (measured: trace x 23.247 → 29.247 mid-drag with fixtures still at 23.247; both 29.247 after release) — screenshotted UI-free for him. Two side wins: a select-click no longer marks the scene dirty (attach used to reach `debounceAutoSave`), and autosave is deferred with the regenerate so a 2 s pause mid-drag can no longer persist a generator whose fixtures have not caught up. 17 new tests (10 scheduler contract units incl. "40 ticks ⇒ ONE flush", ascending multi-trace order, throw-on-bad-index; 7 wiring-regression tests that fail if anyone re-wires `change` or puts a regenerate back in a drag tick) + `agent_tools/generator_ux_verify.cjs` (21 checks, all green, re-runnable). **Sim suite 805/797/8 → 829/821/8 — the SAME 8 failures before and after, zero new.** ⚠ baseline correction: the plan's `805/803/2` predates the operator's 13:46 saves; `models/titanic.js` is stale again (`Left Front Wall Generator …` vs the scene's `Left Front Wall …`, sim banner `981 → 987`), which is what the 8 are. Zero scene/model writes (triple-guarded, 0 save requests attempted; `scenes/**` mtimes 6 min OLDER than the first source edit and unchanged across 7 browser runs); his stack never restarted  **SLICE 3 LANDED (`_46`, 2026-07-29) — name/index parity surfaces + his chimney ring restored.** The 2D Pixel Map `lanes` seeding now compares NATURALLY (`localeCompare(..., { numeric: true })`, pixel_map_layout.js): rows stacked 1, 10, 11, 12, 2, 3… for any group of ten or more — the only genuine ordering bug `_44` found — and now stack 1..12, proven both in unit tests and live through the real panel on a synthetic 12-light group (the live scene’s biggest group is 8, so the bug is not reproducible on it). The renumber confirm now states that engine-model ids (sectionId/fixtureId) and saved 2D pixel-map anchors are sticky-by-name too, not just DMX addresses. **His right chimney ring is BACK in the default Top-Down 2D view**: `pixel_map_view_defaults.js` still named ‘Right Top Chimney Generator’, which resolves to **0 clusters** in the scene — re-pointed at ‘Right SmokeStacks’, and the default view now resolves **8 clusters per ring**, screenshotted. Deriving defaults from live groups (the structural fix that would remove the failure mode entirely) is **deferred for Sina to opt into**; until then a new test fails BY NAME if either group disappears, instead of a silently empty panel. Controllers chain chips gained a tooltip saying the order is CABLE documentation and is never re-derived. **Step 15/18 names-in-3D was BUILT, MEASURED and REVERTED on the operator’s mid-session ruling** (“I don’t like the names on the generator guides too messy, just the index is enough”) — the full `"<group> n"` label measured **7.58× wider than tall** per light, i.e. overlapping noise on a par ring; guides ship INDEX-ONLY, with a cross-module test still pinning the guide number to the `<group> n` suffix a regenerate emits and a harness check that fails if name plates come back. A hover/HUD tooltip remains available as a future on-demand option. 24 new tests; **sim suite 805/797/8 → 829/821/8, the SAME 8 failures, zero new**; parity CLI verdicts byte-unchanged (titanic 192/0/9, test_bench 4/0/1); all 77 `scenes/**` mtimes identical across every browser run, 0 save requests attempted **2D PIXEL MAP DEFAULT VIEWS TUNED (`_48`, 2026-07-29)** — his three view orders, measured on the live scene, zero scene/model writes. **Front view**: membership cut from "all bars + all vintage" (41 clusters, front AND back of the ship) to the six FRONT groups (`Left/Right Front Wall`, `Left Front Deck Generator`, `Right Front Rails`) plus **the four front smoke-stack ropes, TWO per side** (`Left_Front_Left`+`Left_Front_Right`, `Right_Front_Right`+`Right_Front_Left`). ⚠ **Operator correction mid-task**: his "2 lines for the LED strings in the front on each side" means 2 PER SIDE = 4 total; the first pass shipped 1 per side, keeping only the hull drops on the (wrong) grounds that the deck rope's 2.2-unit y-span is not a line in elevation — its length lives in x, so it draws as a long shallow line, and both members of each pair are ropes to the stack. The four are re-derived from geometry, not names: each half of the ship has its OWN forward axis (front-wall centroid − back-wall centroid in x/z; left = (−0.018, +1.000), right = (+0.615, +0.789) — the halves are rotated relative to each other), and projecting every strand midpoint onto it separates front (10.5-12.3) from back (4.3-6.3) with a ≥5.8 margin on both sides. A test recomputes that whole ranking from `scene_config.yaml` and requires a >3 margin, so a geometry nudge can never flip the classification silently. Framing fixed by splitting into **one panel per side**: the two halves stand ~50 world units apart and are ~10 tall, so ONE aspect-preserving elevation could only ever be a 93 %-wide x 24 %-tall sliver — per side it is 74 % x 88 % / 57 % x 88 %, design scale **13.9 -> 37.0 / 36.4 units per world unit (~2.7x)**, ~2x on screen. **Top-Down** (he said it looks good, so no restructuring): strand dots 7 -> 4 on THIS VIEW ONLY so a strand is a thin line not a 7-wide ribbon; a new **paint order** in the projection (many-pixel runs first, single-pixel fixtures last) so a chimney par sitting within 0.05 world units of a strand IN PLAN — they are metres apart in Y, only the top-down projection stacks them — is no longer swallowed, and his ring of eight reads as eight dots instead of three or four; **both small smoke stacks added** (`Left/Right Small SmokeStack`, 4 pars each, tangent Ø13 discs = one small circle apiece) at their true outboard positions rather than in a side panel that lies about where they are (the mistake `_40` removed). **TE Sign rotated 90° CCW** via a new schema-validated per-panel `rotate` (0/90/180/270, TRUE projections only, throws on `radial`/`lanes`): the sign hangs on a VERTICAL plane so `planar`'s widest-axis-first pick had drawn world-UP along screen-X — extreme-point bearing **−177° -> −87°**, width/height **1.37 -> 0.73**, i.e. tip left -> tip down. Also: the **12 orphaned fixtures** (`Left Back Wall` 1-5 + `Left Center Auditorium` 1-7 — coordinates identical to a real group's, and the only two groups in the scene with NO generator trace) are now excluded from the defaults, so a bar row is 5 bars not 5 drawn twice. Every hardcoded group name is now an exported constant asserted against the live scene, so the next rename is a red test naming the group. **Sim suite 903/895/8 — the SAME 8 stale-model failures, zero new**; parity CLI byte-unchanged (titanic 192/0/9, test_bench 4/0/1); newest `scenes/**` mtime 13:46 (his own save), 0 save requests attempted across 5 browser runs. **Honest cost he should rule on: the small stacks stand well outboard, so including them in the same TRUE projection shrinks the rest of the Top-Down view ~28 % (scale 12.8 -> 9.2).** **SLICE 2 LANDED (`_47`, 2026-07-29) — RENAME = CHECK + INVALIDATE, LOUDLY. R10 IS NOW COMPLETE except its operator gates.** His ruling is the shipped default: a rename ENUMERATES what the old names mapped, then invalidates it with **one line per fixture** naming controller / IP / port / universe / address, prunes every old-name `__globalPatchTree` key with its own line (values NEVER copied to the new names), and shows an accurate summary toast instead of the untrue "N deleted fixture(s) unmapped — channels freed". Renamed fixtures come out honestly **UNMAPPED** (`''`/0/0/0 = the validator's `unmapped_fixture`, **never `drift`**); display state — group master override, group view bit, per-fixture `viewMask` — still follows the name, each with a line saying it is display state, not mapping. New pure primitives `describeFixtureMappings` / `invalidateFixtureMappings` (the latter THROWS if an enumerated entry can't be removed — half an invalidation is the silent-partial the codex forbids) + a new pure module `src/dmx/rename_invalidation.js` owning the patch-tree pruning, view-mask carry, duplicate guard and report wording. The `chainSplits` gate now runs BEFORE any mutation (no more stranded old group + `MASK_*` drift on a refused regenerate). Individual renames: one shared path with a duplicate-name guard, and `propagateToSelected` now THROWS on `'name'` rather than stamping one name across a multi-select; the strand path was verified LIVE, closing `_44` §6. Par-group rename finally invalidates the batch cache (`par_group_rename`), and both par and LED group renames re-point 2D Pixel Map `{group: …}` selectors so a rename can never again silently empty a panel (globs left alone as operator intent). **Two defects only the live harness found:** pruned patch-tree keys were being RESURRECTED by a projection that re-mints a key for every live config while the old-named fixtures were still present (fixed by deferring it to the post-sweep regenerate), and the summary toast **never rendered** — 4 px under the multi-client banner AND its fade-in left in flight by the blocking regenerate (inline opacity `1`, COMPUTED `0` after 2 s of rAF polling, invisible in the frame); both fixed, the toast now proven by a cropped screenshot of its own rect. 50 new tests including the **LOG CONTRACT** (the ruling is about what he is TOLD — "it happened to end up unmapped" does not pass) and a wiring test guaranteeing the migrate primitive is never reachable from gui_builder; `trace_rename_verify.cjs` gained MAPPED + REFUSAL + toast-visibility cases, 8/8 green. **Sim suite 903/895/8 — the SAME 8 stale-model failures, zero new**; parity CLI byte-unchanged (titanic 192/0/9, test_bench 4/0/1); all `scenes/**` + `models/**` mtimes identical across 8 browser runs, 0 save requests attempted. ⚠ **Needs his word: (1) RATIFY step 11's refusal** — individually renaming a *generated* fixture is now a loud refusal pointing at the group-rename and ⛓ Chain Order paths (kept trivially revertible: one function + one `if`); **(2) step 11b NOT BUILT** — the opt-in "⇄ Migrate addresses to new name" affordance awaits his yes/no. **RECURRENCE #3 REPAIRED SAME DAY (`_48` addendum 2, off `_51` §6)** — his 16:25→16:38:58 batch renamed 13 of 14 generators and staled TWO more hardcoded 2D-default names, so the LEFT chimney ring and the LEFT front vintage lights were missing from the live pixel map and 4 tests were red: `Left Top Chimney Generator` → **`Left SmokeStack`**, `Left Front Deck Generator` → **`Left Front Rails`**. Re-pointed; a full audit of every other hardcoded name against the 16:38:58 save found the rest live (`ORPHAN_GROUPS` deliberately UNTOUCHED — gated on Open Decisions 11/12). **The same audit caught a second, unreported breakage: his new `TE Sign 2` group.** The te_sign view selected purely by fixtureType, so it swallowed BOTH signs into one `planar` panel — and `planar` scales by true world CELL size, never fit-to-canvas, so two signs 34 world units apart blew the panel to **2.69× the canvas width and 11.07× its height**, rendering almost entirely off-screen. Fixed with ONE PANEL PER SIGN (fill back to 0.17×0.40 and 0.17×0.49, both quarter-turned). The by-name tripwires did their job and are kept, re-pointed; additionally the TESTS' own back-of-ship reference points are no longer literals (all three of theirs went stale in that one batch) — counterparts are now found structurally by fixture type + side (sign of mean world x), and the front/back check became a non-circular “bars and vintage must agree which end is forward”. ⚠ **DESIGN, HIS CALL (`_48` add. 2): the real hole is narrower than ‘hardcoded names’ — `resolvePanel` only fires its loud error on a TOTAL zero-match, so a PARTIALLY stale panel (Top-Down still matched all bars + strands) is SILENT, which is why all three recurrences went unnoticed for hours. Recommended fix = per-SELECTOR zero-match reported loudly at pixel-map open, ~2-4 h; live-derived defaults (~1-2 days) trade a loud failure for a silent heuristic one; an alias/redirect layer is REJECTED as exactly the silent auto-migration the house rule forbids.** New harness GUARD 4 (he is live-mapping real hardware): `window.__readonlyMode` installed as an accessor before any page script so `animate.js` never enables the sACN output client — proven 0 `[sACN Out] Enabling` lines per run — while the Pixel Map still mounts (`?readonly=1` would skip `initPixelMapPanel`). **Suite 980/972/8 — the 4 reds GREEN, same stale-model 8, zero new** (baseline moved 903→924→980 under me as other agents landed work in parallel — judge by WHICH tests fail, not the count); `pixel_map_te_led_classification` was also re-pointed at the per-sign panels. **Zero scene writes** — he saved AGAIN at 16:54:30 mid-task (not the agent: 0 `:6970` requests attempted, all four titanic YAMLs share that one timestamp), and all **16** hardcoded names were re-audited against that newer save: **0 stale**, `Left Back Wall Generator` still present so `ORPHAN_GROUPS` stays valid and untouched. **ORPHAN TRAP FIRED FOR REAL — REPAIRED 2026-07-30 (`_48` addendum 3).** The operator ordered the manual scene fix and the coordinator applied it on disk: the 5 ghost `Left Back Wall` bars are DELETED and his real generator is renamed `Left Back Wall Generator` → **`Left Back Wall`** (verified read-only: that group is now trace-backed with 5 fixtures, no trace name ends in ‘Generator’, `views.yaml` has the single key `Left Back Wall: 0x10`). `ORPHAN_GROUPS` is keyed on the NAME, not on orphan-ness, so the entry instantly began excluding **his real back wall (5 bars / 90 px)** from the 2D views — exactly Trap 3 of `_51` §4. Entry dropped, in BOTH places `_51` §8 flagged (the module and its CommonJS mirror in the verify harness, now annotated as a mirror). `Left Center Auditorium` 1-7 stay excluded — still untraced ghosts, still his call. **The class is now closed by a general tripwire, not another literal**: `NO default view excludes a group that a generator trace owns` walks every default view's exclude list and fails BY NAME if any names a trace-backed group — it would have caught today's trap with no foreknowledge (`fixtureType` excludes, i.e. the TE signs, are deliberately exempt as a real permanent membership decision). Plus a re-expressed orphan pin with an actionable failure message and a direct ‘the de-orphaned Left Back Wall is drawn by Top-Down again’. **Suite 982/974/8 — the SAME 8 named stale-model failures, zero new; all 80 pixel-map tests green.** ⚠ **Parity CLI changed shape as predicted — titanic 192 → 337 errors** (0 warning, 9 → 7 info) purely because the scene moved on disk while the model export did not; test_bench unchanged 4/0/1. **This clears when he re-exports `models/titanic.js` and restarts the engine** — already owed for the earlier drift. Live proof: Top-Down resolves **5 `Left Back Wall` clusters** and the panel header reads **95 fix / 971 px** (was 100 / 1061 — exactly the 5 deleted ghosts and their 90 px), screenshotted incl. a 2× crop showing both left bar rows. ⚠ His stack was DOWN during verification (6969-6972 all refusing — he stopped it to reload the fixed scene); rather than bring it up on the standard ports and collide with his restart while hardware is attached, the harness gained an `--origin` flag and ran against a throwaway READ-ONLY static file server on :7969 (no save server, no sACN bridge in that process at all), stopped immediately after — nothing is listening on 6969-6972 or 7969 now. **OPERATOR-ORDERED DEPARTURES FROM THE TRUE PROJECTION (`_48` addendum 4, 2026-07-30) — a semantic change worth his eyes.** Until now every `spatial`/`planar` panel was strictly TRUE, and `_40`/`_48` both rejected proposals that faked a position; he has now licensed two narrow, named, tested departures, each scoped to the view he asked about and each announcing itself in the console. **(1) Top-Down side-gap compression** — “bring the 2 sides closer so they are seen easier together”. Measured: **48.3 of the view’s 90.5 world units of width (53 %) were EMPTY** (26.5 between the ship’s halves, 13.8 and 8.1 out to the small smoke stacks), and an aspect-preserving fit charges for that by shrinking every fixture. New `panel.compress = { minWorldGap: 5, gapWorld: 4 }` collapses every empty band wider than the threshold to exactly `gapWorld`; it is a PIECEWISE TRANSLATION, so within a side every distance, angle and ordering is bit-for-bit unchanged and the per-side scale is untouched — only inter-side spacing moves. A threshold, not a per-side offset table, deliberately: any table of names goes stale the moment he renames something (the failure mode repaired 3× this session), while the threshold reads geometry. Headroom on the live scene is >3× (collapsed bands 26.5/13.8/8.1 vs largest gap that must NOT move, 1.5) and a test recomputes both from the scene so a fixture move that could tear a side in half goes red. Result: vertical fill **0.714 → 0.881, ~23 % more design units per world unit**, dead middle ~240 → ~45 design units. **(2) Front vintage LED pitch** — “resize the vintage pixels to 6 circles that are a bit bigger”. Six is REAL, not a magic number: `dmx/fixtures/vintage_led_stage_light/model_33.yaml` declares 6 pixels and a test reads that YAML. Glyph sizing alone could never do it — those 6 LEDs sit at a **0.075-world-unit pitch = 2.8 design units**, so six 15-unit discs fuse into the capsule he circled and separating them by size would need ~2-unit invisible dots. New `panel.expandPitch = { VintageLed: 0.6 }` re-lays a cluster’s pixels along ITS OWN projected axis at a declared world pitch, centred on its TRUE centroid — fixture position, orientation and LED order all unchanged, only its internal spacing stretched; per-fixtureType on purpose (a bar would become 18 pitches long, pinned by test). 0.6 was chosen to keep the stretched fixtures INSIDE the existing panel bounds, so both Front panels’ fill fractions are byte-identical to before. Also **distinct bars on Top-Down** (he circled each one): `ShehdsBar` 17→14 per-view, which ⚠ **partially walks back his earlier ‘a bit wider’ ruling (`_40`) on this view only** — with the extra zoom the gap between adjacent bars goes ~3 → ~13 design units; Front keeps the full 17, and he can say ‘no, keep 17’. Strands 4→5. **TE Sign ‘add both signs side by side’ needed NO change** — addendum 2 already made one panel per sign and the multiview tiles panels left→right; confirmed live and screenshotted, so he is on a stale page and just needs a browser reload. **Suite 1017/1009/8 — same 8 stale-model failures, zero new; 15 tests added.** All 16 hardcoded group names re-audited against his 09:36:02 save: 0 stale. Zero scene writes; GUARD 3 + GUARD 4 both held on a live capture against his running :6969. **VIEW ADJUSTABILITY SHIPPED (`_54`, its own report) — “in the 2D views, allow me to adjust the view as I want”.** The shipped defaults were only reachable through an agent; today alone he ordered membership, framing, gap compression, glyph sizes and a rotation through three round-trips. Now HIS, in the UI: **framing** (his pan/zoom per view — the real gap, it was transient and died with the pane, which is exactly why ‘optimize the framing’ had to come to us), **rotate**, **close the gaps** (on/off + gap + threshold), **LED pitch**, **per-view glyph sizes**, and **↺ Reset view to default**. Surface = a ▸ Adjust expander per row in the existing Views manager, showing only what a view can take (glyph rows read the LIVE resolved clusters, so it never offers a type that is not there). Safety: every write re-validates the WHOLE view and **rolls back byte-identically if it throws** (schema message lands in the existing toast, nothing half-applied); no silent clamping; `resetViewToDefault` deep-copies so two resets never alias the shipped literal; reset REFUSES a view he created (‘delete it instead’). Persistence is the existing idiom — `commitViews()` → `params.pixelMapViews`, same path as his hand-placed anchors — so **no agent writes `scenes/**`**, his own Save carries it. Framing zoom bounds are pinned to the interaction layer's wheel clamp BY TEST, or a framing he could scroll to would be silently dropped on reload. ⚠ **Two questions for him** (report §4/§8): (1) framing lives in the scene, so panning around will eventually trigger his autosave — consistent with anchors, but the one-line alternative is localStorage beside the pane-layout tree; (2) **membership editing is DESIGNED ONLY (~half a day, §5.1)** — group chips + add-picker per panel, and he must rule whether removing a panel's LAST group is allowed (leaving the loud red ‘no fixtures match’ banner — my recommendation) or blocked. Also designed-only: per-panel ‘fit to content’ (~1 h). **Suite 1046/1038/8 — same 8 stale-model failures, zero new; 10 new tests**; inspector verified LIVE through the real UI on his running :6969 (reads the real shipped view: gap 4 / over 5 / LedStrand 5 / ShehdsBar 14 / UkingPar 13) and screenshotted; zero scene writes, GUARD 3 + GUARD 4 held. **HIS ANSWERS + FIT-TO-VISIBLE SHIPPED (`_54` addendum, 2026-07-30):** (1) framing-persists-to-scene **approved as-is**, no localStorage move; (2) **membership editing NOT built** — he did not recognise the term, coordinator explaining, design stands pending his word; (3) **“fit to the area not under any menu, active” — BUILT.** Honest finding first: the pane IS genuinely overlapped — measured on his live 1440×900 layout the canvas is 1438×788 and the Lighting Controls panel covers ~330 px of its right edge, plus the camera-chip strip along the bottom, the banners across the top and the Shortcuts pill; the Top-Down right half and the right small smoke stack were running straight under the panel. A **⤴ button per pane header** (existing per-pane idiom — the Adjust panel is per-VIEW and a view can bind to several panes) now: MEASURES obstructions from `document.body`'s child list at click time via `getBoundingClientRect()` (no hardcoded widths, so a dragged divider or resized panel just works — and a child list cannot go stale the way the id lists that broke 3× this session did), TRIMS the pane rect to the cheapest obstruction-free area, SOLVES the framing by binary-searching the largest zoom whose union of panel content still fits (each panel scales about its OWN sub-rect centre, so a multi-panel pane cannot be rescaled by one screen-space similarity — pinned by test), then PERSISTS through the framing sink so a fit is remembered like any pan. Zoom bounded by the same FRAMING_ZOOM_MIN/MAX the wheel and schema use (imported, not restated) and **says so when it hits a bound**. Judgment call: the Views manager overlay is deliberately NOT an obstruction (transient — fitting beside it would leave content wrongly shrunk once closed). Verified LIVE with the panel docked open: framing null → `{zoom 0.914, panX -178.5, panY -57.2}`, content now entirely clear of the panel and the **right small smoke stack, previously hidden under it, fully visible**; harness restores his framing exactly. **Suite 1059/1051/8 — same 8 stale-model failures, zero new; 13 new tests.** **EDIT-MODE MOVE + RIGHT-CLICK GROUP SELECT (`_55`, its own report) — “the edit view … has no move, or edits. Also, can you add right click selection for group selection?”** ⚠ **Move was not missing — it was a SILENT NO-OP**, the shape the house rules exist to prevent. Drag/nudge/rotate/Esc have been in `pixel_map_interaction.js` since S4 and wrote `view.placements`, but EVERY shipped view is a `spatial`/`planar` panel and those layouts compute each position from world coordinates and **ignore placements outright** (the TRUE-projection property `_40`/`_48` deliberately protected) — so his drag ran, persisted an anchor, rebuilt the panel, and nothing moved, with no error anywhere. Fixed with a new per-view **`offsets = { fixKey: {dx,dy} }`** map, a DELTA from the projected position applied AFTER the fit (folding it into world coords would re-run the aspect fit every pointermove and rubber-band the panel while he drags); `placements` semantics on radial/lanes are byte-unchanged and a test pins that a placement still moves nothing on a projected panel. **Granularity = per FIXTURE, and that is not a compromise**: the selection is already a Set of fixKeys and there is no UI path to selecting part of a fixture, so no per-pixel persistence had to be invented. `ctx.getAnchor`/`setAnchor` route a move to whichever model the fixture's PANEL uses, resolved once per rebuild into a fixKey→model map rather than re-resolving on every pointermove. **Right-click selects the whole GROUP within that panel** (shift adds; panel-scoped because a group can span panels and moving unseen fixtures would be wrong), browser context menu suppressed on the canvas. Rotate on a projected fixture is now **refused LOUDLY once** instead of silently doing nothing. Also fixed in passing: `materializeView` was seeding placements for projected panels on every edit press — persistent junk that also dirtied his scene — now skipped. “Reset moves” added per view in the `_54` Adjust panel. **Live-proven through the REAL handlers** on his running :6969: one right-click selected all 5 `Left Front Wall` bars, a drag moved all 5 rigidly to `{dx 56, dy 24}` with every other fixture unmoved, and the offsets came back IDENTICAL after binding the pane away to `front` and back (persistence proof); probe cleared its own moves, zero residue. **Suite 1075/1067/8 — same 8 stale-model failures, zero new; 14 new tests.** Zero scene writes (GUARD 3 + GUARD 4 held). Scope: entirely inside `src/gui/pixel_map/*` + the pixel-map panel shell — no shared GUI file touched, so no overlap with the concurrent GUI-wide wheel-guard work. ℹ Offered for his word: a move is a nudge AWAY from where the projection puts a fixture, not a free placement; a per-panel ‘free placement’ layout mode can be offered if he wants that instead. | **R10 code work is done; what remains is all operator gates.** Sina: **ratify the generated-fixture rename refusal** (`_47` §5) and **say yes/no to the opt-in address-migrate affordance** (`_44` §5 Q4, step 11b); rule on `_48` (keep the two small smoke stacks on the Top-Down view at ~28 % scale cost, or drop them? delete the 12 orphaned fixtures from the scene? **and pick a durable fix for 2D-default name drift — `_48` add. 2 recommends per-selector zero-match reporting, ~2-4 h**), answer the Top-Down default question, gate the chain-sort button + numeric bulk-add + the opt-in address-migrate affordance (`_44` §5), and **re-export `models/titanic.js` + restart the engine** to clear the stale-model failures. Also worth his eyes: titanic has co-located fixtures (`"Left Back Wall 1" & "Left Back Wall Generator 5"`, 3 more) that raise the overlap toast on every rebuild. **`_51` DIAGNOSED the "Left Back Wall Generator still troublesome" report (2026-07-29, diagnosis-only, offline repro on read-only scene copies — no browser opened, hardware attached):** he renamed **13 of 14** generators today (`… Generator` → plain names, `15:19` + `16:38` saves) and this is the **only refusal** — `traceRenameError` (pre-`_47` `_37` code, first gate, zero mutations, input reverted) fires on the **5 orphan `Left Back Wall 1-5` fixtures**, message `A group named "Left Back Wall" already exists.` **`_47`'s code is correct**; all 13 successes carried view bits/overrides cleanly (`views.yaml` has ZERO stale keys, no new orphans). NEW EVIDENCE the 12 orphans are **junk, not lights**: bit-identical duplicates (position/rotation/type/color/intensity) of live runs — `Left Back Wall 1-5` ≙ `Left Back Wall Generator 5,4,3,1,2` (the permutation IS the `chainSplits` order), `Left Center Auditorium 1-7` = the same auditorium line before he bumped it 7→8; backups show he created the ` Generator`-suffixed traces on 07-24 19:45 **because the plain names were already taken**. Measured cost: **97 of 987 px (9.8 %) in `models/titanic.js`** (model indices 0-96, first two sections), 12 of the parity validator's 98 `unmapped_fixture` errors, 2 view bits, the 5-cm overlap toast on every rebuild, and **10 Unmapped-tray entries for 5 physical bars** while he maps controllers. THREE TRAPS on the fix path: (1) the group card's **`✕ Delete` does NOT delete** — it re-homes fixtures into another group with no confirm (the orphans would land in `Left Center Auditorium` / `Left Back Wall`); the real control is per-fixture **`✕ Remove`**; (2) delete-then-rename without an intervening **save** takes `renameGroup`'s merge branch and the group inherits the orphan's bit 524288 instead of carrying 16; (3) **once the rename succeeds the real bars VANISH from the 2D Top-Down view** — `ORPHAN_GROUPS` in `pixel_map_view_defaults.js:94` hardcodes the string `'Left Back Wall'` (and its tripwire test is dead: reads `scene.parLights.traces`, should be `scene.traces`). ⚠ **ALSO FOUND, live right now:** his `16:38` rename batch already went stale on two hardcoded 2D-default names — `Left Top Chimney Generator` (→ `Left SmokeStack`) and `Left Front Deck Generator` (→ `Left Front Rails`) — **4 red tests**, and the **left** chimney ring + left front vintage lights are **missing from the 2D pixel map**; identical to what `_46` fixed for the *right* ring. Third recurrence ⇒ live-derived 2D defaults (`_44` §5 Q2) is now the structural answer | agents (slices) + Sina (gates) |

## 6. Open decisions (Sina) — the full numbered list

The live doc keeps only the genuinely open ones, numbers preserved. Settled
here: 1–4 (shipped in R1's session model and the playlist trio), 8 (resolved
2026-07-27 by delegation), 11 (the orphans were deleted by the operator after
`_76`).

## Open decisions (Sina)

1. **Party session end** (R1 audit options): (a) fixed 12-min timer —
   zero timeline code; (b) follow-the-music with 10-min floor;
   (c) extend-while-music-persists, 45-min cap.
2. **Cooldown** before re-trigger (audit recommends 15 min).
3. Keep or drop the `whenPhase: party_night` gate on party detection?
4. Confirm the `ambient`/`party_high`/`party_low` playlist trio — the
   playlists don't exist yet (only `default`); this blocks R2/R3.
5. Pick a playa (or driveway) night for the ambient-vs-party baseline
   capture (threshold calibration).
6. TE sign test_bench mapping (`20260725_4`): agent applies via live UI, or
   Sina maps it himself?
7. Scheduled party moments: how many / what times (rough is fine).
8. CaptainPad UI wave (`20260725_9`): mixer-globals portrait layout A/B
   (blocker), deck split ratio, effects label policy; green light to
   implement? → RESOLVED 2026-07-27 by delegation (option A / 20% /
   single-line; wave in flight).
9. Themed playlists: which of the proposed themes (§Specialty) to adopt,
   and which nights get them.
10. UV spike: go/no-go after the on-fixture test (also confirm UV
    channel presence in the par inventory).
11. **The 12 orphaned fixtures / the "Left Back Wall" rename** (`_51`):
    (A) **delete** them — per-fixture `✕ Remove`, NEVER the group's
    `✕ Delete` (it re-homes, it doesn't delete), then **save**, then
    rename; (B) **park** them via the group's `✏ Rename` (reversible,
    but keeps 97 phantom px + 12 phantom parity errors); or (C) leave
    the generator named `Left Back Wall Generator` (zero work — the
    refusal is correct behaviour). Evidence says they are duplicates of
    live runs, not lights — but they are his data, so only he can
    authorise the delete. **A or B both require an agent follow-up:**
    drop `'Left Back Wall'` from `ORPHAN_GROUPS`
    (`pixel_map_view_defaults.js:94`) or the renamed real bars vanish
    from the 2D Top-Down view.
12. **Live-derived 2D default views** (`_44` §5 Q2, now third recurrence
    via `_51` §6): every group rename re-breaks the hardcoded names in
    `pixel_map_view_defaults.js`. Keep patching names, or derive the
    defaults from live groups?

## 7. Specialty & themed playlists (operator, 2026-07-27)

Still-unadopted proposal content, parked with R2/R3. Moved here whole; the
live doc points at it from the R2/R3 rows.

## Specialty & themed playlists (operator, 2026-07-27)

Operator requirements, verbatim intent:

- **WHITE ONLY** — patterns that render pure white only, plus a
  `white_only` playlist of them. (Uses beyond looks: Temple night,
  visibility/work light, elegant mode.)
- **UV ONLY** — an experimental UV-only pattern "to test and see how they
  look — not sure if I want it fully." Treat as a SPIKE: build one, test
  on real fixtures (confirm which pars actually have UV emitters), Sina
  decides go/no-go afterward. Not part of any program until approved.
- **Themed playlists** for playa days ("like Tutu Tuesday") — coordinator
  proposed the list below; Sina curates.

Proposed themes (PROPOSED 2026-07-27, none approved yet):

| Playlist | Night | Look |
|---|---|---|
| `tutu_tuesday` | Tuesday | Pink/magenta everything — playa tradition |
| `white_wednesday` | Wednesday | The WHITE ONLY playlist's showcase night |
| `iceberg_ahead` | any | Titanic signature: icy cyan/blue/white shimmer, slow menace |
| `first_class_1912` | any | Vintage golds, candlelight warmth, elegant slow patterns (vintage lights featured) |
| `deep_sea` | late-night ambient | Deep blues/greens, bioluminescence pulses |
| `burn_night` | Saturday | Fire palette — ember/orange/red, max energy, party_high's big sibling |
| `temple_white` | Sunday | Reverent: dim warm-white slow washes only (WHITE ONLY subset, low brightness) |

Implementation note: these are R2/R3 content — additive to the R1
detection trio (`ambient`/`party_high`/`party_low`), which stays the
machinery for auto-switching. Themed playlists get scheduled (R3
program) or hand-picked from CaptainPad.

## 8. Decisions log — the full list

The live doc keeps the most recent entries and points here for the rest.

## Decisions log

- **2026-07-27** — Operator: "use opus agents, and continue on the plan
  until you are happy with it; when done, let me know" — decisions
  DELEGATED to the coordinator. Coordinator picks (revisable by Sina):
  session end = fixed 12-min timer + 15-min cooldown (§Open 1–2);
  detection not phase-gated (§3); playlist trio confirmed as DRAFT
  structure, Sina re-curates in R2 (§4); UI wave: mixer globals
  option A, deck pattern list 20 %, single-line effect labels (§8).
  Still genuinely Sina's: baseline-capture night (§5), TE sign
  mapping (§6), party-moment schedule (§7).
- **2026-07-27** — Operator manages the :6967 Expo/Metro instance
  himself; agents never launch/kill it.
- **2026-07-29** — Standing model policy: **all sub-agents run on Opus
  unless the operator directly names another model** for a task.
- **2026-07-30** — Operator-ordered EXCEPTION to scenes-are-operator-
  owned: coordinator manually fixed `simulation/scenes/titanic/`
  ("remove the left back wall, rename the generator … yourself
  manually") — 5 ghost fixtures deleted, `Left Back Wall Generator*` →
  `Left Back Wall*` across scene/patches/views, verified 0 stale refs;
  his subsequent saves re-projected patches cleanly (sticky-by-name
  held). The 7 `Left Center Auditorium` ghosts remain, undecided.
- **2026-07-30** — Standing order: doc inconsistency vs verified
  behavior → **fix and clean up on sight** (memory fact
  `doc_inconsistency_standing_fix.md`); first application `_57`.
- **2026-07-30** — Operator confirmed 2D-view framing persists to the
  SCENE (rides his save/autosave) — approved as-is, no localStorage.

## 9. Log — every dated entry through 2026-07-30

The complete narrative log, newest first, 2026-07-30 back to 2026-07-27 —
roughly 2,970 lines. The live doc's `## Log` starts empty from here on and
points at this section for everything before it.

## Log

- 2026-07-30 — **ZERO RESTARTS: "map a universe → save → LEDs work" is now
  true end to end (`_87`).** Operator, after `_86` did its job: *"I still had
  to kill and restart the launcher. Can we make sure this can be done without
  a restart?"* Two causes, one of them invisible. **First**, that restart was a
  **one-time activation**: the bridge serving him all day predated `_60`'s S3
  runtime `addUniverse`, because S3 was deliberately written without restarting
  a bridge feeding lit hardware. His restart put S3 into service AND re-read
  `_86`'s widened boot list, so both effects landed at once and looked like one
  recurring step. Waiting item 16 is **DONE**. **Second — the real find** — two
  links in the chain were genuinely restart-bound. **(A)**
  `readSceneRoutePairs` read a patch record's `dmxUniverse` and nothing else.
  That is the START universe: an LED strand record also carries `segments[]`,
  one run per universe it occupies as it walks past channel 512. A 200 px RGBW
  rope at U30 therefore got a relay route and a subscription for U30 and
  **nothing for U31** — pixels 129+ dark, `Route created` in the log, monitor
  green, `patches.yaml` fresh, and **restart-proof**, because the boot scan read
  `dmxUniverse` too. No strand is long enough to trip it today; his rope mapping
  is heading straight at it. **(B)** the `📡 Subscribed Universes` field was
  read **once, at boot** — and it is the operator's only way to declare a
  universe nothing in the configuration implies (a console, a second machine;
  his field carries **U32–U37** with nothing patched on them right now). `_86`
  kept the file honest; the running receiver never saw it. **Both closed by
  re-reads, not machinery:** `recomputeRoutes()` already re-read `patches.yaml`
  per active scene on every `setScene`, so the field is now re-read in the same
  place and joins the same `wanted` union, and both the boot scan and the
  runtime diff share ONE reader for "what a patch record occupies" and ONE
  parser for the field — pinned token-for-token against the browser-side parser
  the dialog uses, because a gate reporting a set the bridge does not subscribe
  to would be the original silent-dark shape one level up. Bonus: the `1-24`
  range trap (the field has no range syntax; that means U1 and 23 dark
  universes) is now **warned about** instead of silently parsed. Ordering
  re-verified end to end: `writeFileAtomic` finishes before the save server
  answers 200, the notify is chained on that awaited/verified 200 (`_61` S4),
  and the bridge's `setScene` handler always recomputes — so the file the
  bridge reads is always the one just written. Dialog caveat replaced with the
  now-true statement and the acceptance lines named: *"✅ Takes effect
  IMMEDIATELY on save — no bridge restart… Watch the bridge console for
  'runtime-subscribed U…', then 'First frame on U…'."* **No genuinely
  restart-bound case survives**, so nothing replaces the caveat. Proven by
  running the real `sacn_bridge.js` in a throwaway process with `sacn`/`ws`
  faked — no port bound, no multicast joined, no datagram sent, his live bridge
  untouched — against the real titanic files, including a harness that returned
  a narrow field on the boot read and a wide one afterwards (exactly what a save
  does under a running bridge): `runtime-subscribed U999
  (📡 Subscribed Universes field)`. Suite **1452/1442/10**, +19 tests, failure
  list byte-identical; the 10th failure is operator-side scene drift since `_86`
  measured 9, not this work. Acceptance recipe for his next real mapping change
  is `_87` §7 — `20260725_87_no_restart_subscription.md`.

- 2026-07-30 — **`📡 SUBSCRIBED UNIVERSES` IS NOW DERIVED, NOT REMEMBERED
  (`_86`).** Operator: *"there's a really annoying thing… this causes off
  lights."* He is right, and the mechanism is the nastiest one in the stack:
  the sACN-in bridge builds its receiver accept-list **once at boot** from
  `colorWave.sacn_universes` (persisted in the operator-owned
  `scenes/common.yaml`), and the `sacn` package **drops packets on
  unsubscribed universes with no event at all** — so a field that has fallen
  behind the mapping is dark fixtures while disk, routes, monitor and logs all
  read healthy. `_60`'s runtime `addUniverse` only extends a *running*
  receiver; the boot list was still this field. **Fix at the source:**
  `exportConfig()` now runs a gate BEFORE `saveModelJS()` — so `Cancel` really
  means nothing on disk — that unions every universe the configuration uses
  from the projections the Controller Mapping pane already computes
  (`computeProjection().universeMaps`, `computeLedUniverseClaims()` incl.
  **spill** segments, declared DMX + LED per-output port rows even when nothing
  is patched on them, **parked outputs** from `_71`, and the stored
  patches.yaml records). Required ⊆ subscribed → silent save, no popup spam.
  Short → one blocking **Yes / No / Cancel** card in the push flow's own modal
  skin (no new framework, no new CSS) showing `1, 2, 3 → 1, 2, 3, 27, 30` plus
  `+ U27 — LeftLeftRopes port 2 → output 2` per addition. **Update + save**
  persists the widened field through that same save (the existing save-server
  path writes `common.yaml`; no new code touches it); **Save without updating**
  saves and logs the decline; **Cancel** aborts everything. It **never
  removes** — extras are one FYI line, because a shrunk subscription fails
  silently while a spare one is free. The card states the honest caveat: it
  takes effect at the **next bridge start**. One knob added:
  `exportConfig({interactive:false})`, used only by the 2 s auto-save timer,
  which warns to console instead of raising a modal — so every operator-driven
  save path (controller pane 💾, Lighting Controls 💾, LED push) behaves
  **identically**. Also found and surfaced: the bridge parser has **no range
  syntax**, so a hand-typed `1-24` subscribes to U1 alone — now reported as a
  loud finding rather than 23 dark universes. Suite **1433/1424/9** (+30 tests,
  failure set byte-identical). No browser session, no scene save, no device
  contact, no restart — `20260725_86_subscribed_universes_autosync.md`.

- 2026-07-30 — **THE SAVE BUTTON NO LONGER PAINTS OVER THE TRAY CHIPS
  (`_85`).** Operator screenshot: `💾 Save Configuration` floating mid-tray on
  top of the "TE Sign V3 A/B" chips, cramped chip rows, help line squeezed
  against the second row. **It was never absolute positioning** — the button
  was a bare flex item in `#cm-body` with nothing reserving its space, and
  `.cm-tray` was the one element that could be flex-shrunk below its own
  content (`min-height: 0` under `.cm-user-sized` / `.cm-controllers-collapsed`)
  while its `overflow` stayed at the initial **`visible`** and its chip grid
  carried a hard `min-height: 40px` floor. `_65`'s taller MarsinLED gamma cards
  pushed `#cm-body` into **negative free space**; part of that deficit landed
  on the tray, its box shrank, the chip grid refused to follow, and the chips
  painted straight through the tray border onto the Save row that follows them
  in DOM order — so the later-painted button drew on top. **Fix:** the Save
  button gets its own anchored `.cm-footer` toolbar (`flex: 0 0 auto` — it
  never shrinks, so `.cm-main` and the tray yield first); `.cm-tray` now
  **clips** (`overflow: hidden`) and is shrinkable everywhere; the chip grid
  scrolls with **no `min-height` floor in any of its three state rules**; and
  the docked pane gives the tray a hard `min-height: 96px` floor so however
  tall the gamma cards get, `.cm-main` (which scrolls) gives the space up
  instead. Plus sane chip row spacing, a wrapping tray head, the filter width
  moved out of an inline style into `.cm-input.cm-tray-filter` (so the docked
  pane can widen it), and docked density for the tray. One finding caught by
  the probe and fixed: a shrinkable hint made the Save row **hop 34 px**
  between collapse states and truncated the help text — the docked hint is now
  `flex: 0 0 auto`, so both rows sit at one constant y. `_50`-wave behaviour
  (collapse toggle, two-row card header, `--sim-pane-left` pill keep-out,
  natural sort, once-per-render tray sources → 6 filter keystrokes in **1 ms**)
  all re-verified intact. Suite **1403/1394/9** (+12 tests, failure set
  byte-identical to baseline). Live geometry proven on the docked pane with the
  readonly-guarded probe (sACN OUT blocked and asserted, `framesSent=0`, 0
  saves, 0 device HTTP): Save/hint overlap with the tray and chips = **0 px**
  in both expanded and collapsed. **What he sees after a hard reload:** the
  Save button on its own separated row at the foot of the pane, never over a
  chip, at the same spot whether the controllers list is shown or hidden.
  Open, NOT this fix: the probe's three "no rebuild" node-identity checks fail
  in both runs and independently of this diff — something re-renders the pane
  once asynchronously early after open (likely the lil-gui `.listen()` +
  `onChange` on *Show Unpatched (Red)*, `gui_builder.js:1659`, which calls
  `refreshControllerMapPanel()`); the mid-mapping behaviour that matters (an
  in-progress tray filter, tray position) is unaffected and passes.
  — `20260725_85_unmapped_tray_layout.md`
- 2026-07-30 — **Sanity check of `_83` PASSED (`_84`)**: suite 1391/1382/9 confirmed; the 9th failure is `the compression threshold has real headroom on the live scene` (`pixel_map_view_defaults.test.js:487`, band 5.20 vs 7.5 required) — **operator-scene drift** from the Left Small SmokeStack x-move, not a code regression, but a real Top-Down-compression margin warning for the operator; `trace_anchor.js` `??` contract, scene-graph-free generation, disk scene self-consistency and sticky-by-name pins all verified.
- 2026-07-30 — **MOVING A GENERATOR NOW MOVES ITS FIXTURES — LIVE AND AFTER A
  RELOAD (`_83`).** Operator: *"I moved the Left Small SmokeStack, but the
  lights don't move to the new location of the generator. And when I refreshed,
  they were way off."* **Two independent causes, and the fact that they were
  two is the bug**: a generator's anchor was computed TWICE, in two different
  ways, and the two disagreed. **(A) Live** — `generateGroupFromTrace` took the
  circle anchor out of the THREE **scene graph**
  (`window.traceObjects[i].group.matrixWorld`), not out of the trace. Nothing
  ever detached the transform gizmo across a `rebuildTraceObjects()`, so after
  any Radius / Arc / Lights / Start / End edit, generator add-delete or undo the
  gizmo was still holding a **hitbox that had been thrown away**; the drag
  handler then copied the visual group off the **live** hitbox (object to
  object), so `trace.x/y/z` moved while the group — and therefore the fixtures
  generated from it — did not. The `?.group` in that lookup was also a silent
  fallback: with no group at all a circle's fixtures were emitted at raw local
  ring coordinates, i.e. around the world **origin**, with no error. Same class,
  second front: the card's geometry number fields (Radius, Arc, line/corner
  Start-Corner-End) only redrew the preview and never regenerated, so those
  edits "took effect" one reload later. **(B) Reload** — `buildTraceObject`
  rebuilt the circle group from **`trace.y || 5`**, a FALSY default. Left Small
  SmokeStack stands **on the deck at y = 0** (its saved `y` is literally `-0.0`;
  the gizmo's 0.5 translation snap lands on exact zero), so every reload rebuilt
  it **5 m in the air** and boot regeneration put all four fixtures up there —
  and because the hitbox went up with it, the next drag wrote `y = 5 + delta`
  and the error **compounded one storey per cycle**. That is the "way off".
  **Blast radius, measured across every scene in the repo: exactly one
  generator** — Left Small SmokeStack is the only circle trace anywhere with
  `y == 0` (Right Small SmokeStack sits at 0.2497, truthy; line/corner traces
  have no anchor at all). He found the only instance in the building. **Fix:**
  new pure `src/dmx/trace_anchor.js` is now the ONE definition of where a
  generator sits (`??`, never `||` — a missing field gets the documented
  default, a present 0 gets 0), consumed by `traceAnchorMatrix` /
  `applyTraceAnchor` in gui_builder; **generation no longer touches the scene
  graph at all**, so live and reload are the same function of the same data and
  cannot diverge. Plus: the gizmo is detached on destroy and **re-attached to
  the rebuilt mesh** (`captureTraceGizmoTarget` / `restoreTraceGizmoTarget`); the
  circle drag branch is one-directional (dragged object → trace fields → every
  visual); all 11 geometry fields ride the same cold-move contract as a gizmo
  drag (dirty-mark per tick, ONE regeneration on `onFinishChange`, so `_44`'s
  2.4 s-per-tick stall stays fixed); the aim target now travels with a circle
  move exactly as line/corner already did; and the dead
  `writeTraceTransformToConfig` — a second, uncalled writer of the same fields —
  is deleted. **Hand-tweak policy, decided honestly: RE-SNAP, LOUDLY.** A
  trace-generated fixture has nowhere to store a manual offset (the sweep
  discards every record and boot regenerates every generated trace, so a hand
  nudge never survived a reload anyway); carrying it as a delta would mean a new
  serialized per-fixture field invented behind the operator's back. So the
  behaviour is unchanged and now **named**: new pure
  `src/dmx/generator_hand_tweaks.js` reports the fixtures that did not move with
  the rest — but only when a clear majority shares one displacement (i.e. a pure
  move, where the answer is unambiguous); on a layout change it stays silent
  rather than crying wolf. Console warning + toast. **Untouched by a move and
  pinned by test:** names, group, DMX patches (sticky by name), chain splits, 2D
  pixel-map selectors, and the operator-placed per-fixture VIEW-space offsets
  (kept verbatim — a world move says nothing about them). `renderPos` /
  `localPos` are per-pixel and local to the fixture group, so `_74`'s
  drawn-vs-physical invariant is untouched; pinned anyway. **His repair:** the
  scene file on disk is already self-consistent — do NOT save the currently open
  tab (its in-memory fixtures are the y = 5 set), hard-refresh, confirm the ring
  is on the deck; only if it is not, press ↻ Regenerate once and save. Tests
  **1366/1357/9 → 1391/1382/9** (+25, zero new failures) —
  `20260725_83_generator_move_fixture_sync.md`.

- 2026-07-30 — **THE "BIG LEAK" WAS REAL: UNPATCHED FIXTURES WERE EATING 60% OF
  THE ANALYTIC LIGHT POOL (`_82`).** Operator, straight after `_81`: *"a big
  leak — the par light halos on the right side are being mapped, but they are
  not patched, please fix!"* **He was right and "mapped" was literal.** First
  the diagnosis, live and readonly-guarded: **nothing unpatched is lit** — all
  80 fixtures on both buses, every layer that can carry light (bulb, halo, cone
  `instanceColor`, per-pixel `p.color`, LED sprite halo, shell tint): 42
  unpatched, **0 lit**; `_81`'s gate holds. **But 36 of the 60 active analytic
  SpotLight slots — 60% of the budget — were held by those unpatched,
  pure-black right-side fixtures** (Right Front Wall 8, Right Back Wall 8, TE
  Sign 6, TE Sign 2 6, Right Front Rails 3, Right Back Rails 3, Right
  SmokeStacks 2), emitting nothing and **evicting the patched left side**,
  which got only 24. The pool is a fixed, GPU-bounded set of slots handed to
  the pixels CLOSEST TO CAMERA, and it never asked whether a winning pixel was
  emitting; every unpatched fixture in this scene is on the right, and so is
  the camera. In `full` the analytic SpotLight is what casts a fixture's
  visible pool of light on the hull — the "halo" he means, far bigger than the
  halo mesh. **It also retro-explains the whole red-halo saga:** before `_81`
  those same 36 slots held RED spotlights (undriven-red `(1,0,0)`) at
  unpatched fixtures — red light pools no halo knob could touch. **Fix:** new
  `src/core/analytic_light_gate.js` — one rule, `max(r,g,b) >= 1/255`, applied
  where the pool's requests are built (both branches). It is about EMISSION,
  not patching (a patched fixture at blackout wastes a slot too), it is
  visually identity-preserving (a black light contributes exactly zero),
  nothing is sticky (requests rebuild every frame), and with "Show Unpatched
  (Red)" ON the red diagnostic legitimately takes slots again. Ruled out and
  recorded: cross-fixture index bleed (not happening — now pinned by test), a
  later per-frame writer repainting halos (`updateVisualsFromHitbox` only
  repaints config colour when NOTHING is patched — pinned), the prio-150
  sACN-OUT writer (skips fixtures with no universe/addr/IP),
  `getSafeLightColor` (substitutes only on NaN). **Live before→after in his
  stack:** active slots emitting nothing **36 → 0**, owned by unpatched
  fixtures **36 → 0**, patched+emitting **24 → 60**; the hull goes from a thin
  red wash to a broad amber light pool in the capture — the pattern was
  sending that amber all along. **Add-on, his revision mid-session** (*"move
  that to the options as it affects the LEDs too"* → *"actually don't move —
  clone it in the options too, but sync them to 1 value"*): **"Show Unpatched
  (Red)" now appears in Lighting Controls → ⚙️ Options AND at the top of the
  fixtures panel**, built by ONE function, bound to ONE param (one persistence
  key, no mirror state anywhere), both `.listen()` — the same mechanism that
  already synced the Controller Mapping panel's button. Verified live by
  clicking each control: flipping either moves the param, BOTH displays and the
  fixtures (`#000000` ↔ `#730000`) together; restored to his OFF. `common.yaml`
  untouched (operator-owned) — code-side control. Suite **1366/1358/8** (+13
  tests, zero new failures), `node --check` clean, 0 sACN-OUT, 0 saves, no
  device HTTP, no git. Report
  `202607/20260725_82_unpatched_halo_leak.md`.

- 2026-07-30 — **THE RED LEAVES THE BEAUTY VIEW — BOTH GATES SHIPPED, BOTH
  DECISIONS CLOSED (`_81`).** Operator, third complaint on the same thing:
  *"the par lights still have the halo red shit! and it's the Left Auditorium
  I am looking at now."* Read as the ruling on item 26 AND on `_79`'s
  trace-dot decision. **First, the live diagnosis** (readonly-guarded probe of
  his running stack, 0 sACN-OUT / 0 saves): that one view contained ALL THREE
  reds at once — **Left Auditorium 1–8 are PATCHED** (U8:1/11/21/31,
  U6:1/11/21/31) and genuinely driven `[dimmer 100, R 47, G 0, B 0]`, pure
  red; **Right Auditorium 1–8 beside them are UNPATCHED** and were carrying
  `paintUndrivenEntry`'s `#730000`; and **every par in both rows wore a trace
  preview dot at distance 0.000–0.001**. The missing piece neither `_78` nor
  `_79` had alone: the dot is **opaque r=0.3 against a bulb of r=0.2223**, so
  it COVERS the bulb and leaves only the additive halo (r=0.4713) showing —
  **an annulus**. A red-driven par therefore rendered as a red RING around a
  mint-green disk. That is exactly the shape he kept reporting, which is why
  "not a render bug" never landed. **Gate 1 (item 26 → option B):**
  `paintUndrivenEntry` now obeys "Show Unpatched (Red)" like the other two
  indicators — off ⇒ black on bulb, halo AND dot; on ⇒ the 2026-06-12 red
  returns byte-identical. The 2026-06-11 anti-bleed guarantee is untouched
  (undriven entries are still actively repainted and still flagged; the toggle
  picks WHICH repaint, never whether), `demapSacnToPixels` now **throws** if
  the toggle argument is missing, and `_sacnUndrivenRed` makes a live flip
  repaint on the next frame with no reload and no per-frame cost. **Gate 2
  (`_79`'s decision):** one new gate `src/gui/trace_visual_gate.js` — trace/
  generator visuals stay OFF by default in the beauty profiles (`emissive`,
  `full`, now flagged `beauty: true` in `profile_registry.js`), ON in every
  working profile as before, and an explicit `Show Generators` flip outranks
  the default anywhere. Edit-class behaviour unchanged; ⛓ Show Chain Order
  keeps its existing subordinate design; the "he chose it" mark sits on the
  control (not the handler) so undo/redo can't forge it; `common.yaml`
  untouched (operator-owned) — code-side defaults only; invisible trace
  objects also stopped swallowing clicks. **Live before→after in his own
  stack:** trace visuals drawn in `full` **114/114 → 0/114**; unpatched
  Right Auditorium bulb+halo **`#730000` → `#000000`** (entries still marked
  undriven — no bleed); patched Left Auditorium untouched. Both toggles
  re-verified live with restore: red ON → `#730000` back instantly, Show
  Generators ON in `full` → 114/114 back. **HONEST CAVEAT, stated to him:
  the Left Auditorium pars will still glow red-orange after the reload —
  they are patched and the pattern is sending red.** What changes is the
  shape (glowing disc, not a ring) and the unpatched row going quiet. Suite
  **1353/1345/8** (+18 tests, zero new failures; the 8 are the known
  stale-model ones), `node --check` clean. No scenes, no engine, no saves, no
  device HTTP, no git. Report
  `202607/20260725_81_undriven_red_gating.md`.

- 2026-07-30 — **THE LEFT MENU NOW SORTS BY NAME, EVERYWHERE (`_80`; display
  order only, zero data reorder).** Operator with a screenshot of the sidebar:
  *"please in the menu for the instances and generator lists for dmx and LED
  too — sort by name."* Six lists now render name-sorted: **Light Instances**
  group folders + the fixture cards inside each, **📐 Group Generator**
  cards, **DMX Instances** cards, **LED Fixtures → ✨ Generators** buttons,
  and **LED Fixture Instances** strand groups + their strands. Both
  "→ Move…" group pickers follow. Sorting is **natural** (`Bar 2` before
  `Bar 10`) through the ONE shared comparator
  (`src/core/natural_sort.js`, one cached `Intl.Collator` — no second
  comparator, no per-item `localeCompare`, the `_50` perf bug); one helper
  `sortByNameNatural(items, nameOf)` was added there, non-mutating and
  fail-loud on a missing accessor. **Nothing under the labels moved:** every
  list sorts a COPY at render time, each row carries its real source index
  (every hook below the label is index-keyed), and `params.parLights` /
  `params.traces` / `params.ledStrands` / `params.dmxFixtures` keep their
  order and identity — chain order, patch derivation, model export and YAML
  serialization are byte-identical on save. Two things deliberately stayed
  put: `Ungrouped` still pins LAST (display bucket, not a group), and the
  group-DELETE reassignment still reads the un-sorted `groupOrder` because it
  *writes* `config.group`. `_76`'s orphan badges/banners and `_plainTitle`
  open-state keys are untouched. Tests **1335 / 1327 / 8** (baseline
  1316/1308/8 — +19 tests, +19 pass, 0 new failures; the 8 are the known
  stale-model ones). No browser, no saves, no device HTTP — lockdown
  respected; he sees it on next reload. Report
  `202607/20260725_80_menu_name_sort.md`.

- 2026-07-30 — **INDEPENDENT DMX-HALO DOUBLE-CHECK — ALL PASS, ONE NEW FINDING
  (`_79`; read-only Fable verifier, zero source changes).** Two fresh
  readonly-guarded sessions (0 sACN-OUT, 0 saves, params/configs restored) at
  his live settings (pixel 1.9, halo 1.4, `full`, sacn_in, patches active).
  (1) Every DMX class renders a halo: par 0.4713, bar 0.03498, vintage 0.11925
  — all exactly 2.12× their drawn bulb. (2) Global Halo Size moves all three
  live; ratio = `dmxHaloRimMultiple` to the digit at 0.5/1.4/2.5/5; ceilings
  confirmed exact — bar 0.0825 and vintage 0.28125 touched precisely at slider
  max, par uncapped/linear (pitch 0). (3) Local `Halo ×` multiplies exactly
  (par + vintage at ×0.5/1/2), bulb untouched. (4) LED "Halo Size" 0.05→0.25
  leaves all DMX classes byte-identical while sign+strand move — design holds.
  (5) `_78` staleness scan: all 76 DMX fixtures × every pixel, bulb vs halo
  instanceColor, two samples with bulbs animating — **0 mismatches, 0
  red-ring signatures**, independently corroborating the `_78` disproof
  (sampled colors `[0.451,0,0]` = the undriven-red paint reaching both layers
  equally). **NEW:** the ring-shaped impostors in the beauty render are
  **trace generator preview dots** (opaque `r=0.3` spheres, spacing gradient
  blue→green→**red**) plus end/start/aim handles (`r=0.4`, `#ff4400` @ 0.7) —
  visible in `full` because `generatorsVisible` defaults true; a bar's whole
  mid-section is swallowed by a dot 8.6× its halo, and a stretched-spacing
  par wears a literal red ring. A/B proof: hiding the real `haloInst` leaves
  the disk, hiding the trace dot removes it. Decision owed (operator): gate
  trace visuals out of `full`/`emissive` or default generators off outside
  `edit`. Report `202607/20260725_79_dmx_halo_doublecheck.md`; 10 inspected
  screenshots in `.agent_renders/` (`*_dhdc_*`, `*_dhdc2_*`).

- 2026-07-30 — **THE RED PAR HALOS ARE NOT A COLOUR BUG — measured, diagnosed,
  decision owed (`_78`; diagnosis + GUI labels only, no behaviour change).**
  Operator after his hard reload: "great progress", LED strings + TE sign good,
  then *"there's an extra halo around the par lights that are red, but those pars
  are mapped patched and are good"* and *"the red halo around the par in the
  auditorium which is patched still exists."* **The proposed mechanism (driven
  path writes the BULB instanceColor only, halo keeps its construction colour) is
  DISPROVED.** A readonly-guarded probe read both buffers for all 40 UkingPars at
  the same instant: **zero mismatches** — `_writePixelColor` writes bulb, halo
  and cone in ONE call, so they cannot diverge. Both of his witnesses were in the
  same pass and behave identically. **The red has two legitimate sources:** the
  roof-edge row in his screenshot is **UNPATCHED** (only 8 of 40 pars are
  patched) and `sacn_mapper.paintUndrivenEntry` paints every undriven entry pure
  red — `#730000` is exactly `(1,0,0)` × the sim-brightness preview scale 0.451,
  an exact numeric match — which is an **explicit operator ruling of 2026-06-12,
  "red, not black"** (it exists to stop skipped entries freezing the last pattern
  colour, report 2026-06-11); and the patched Left Auditorium par is genuinely
  being driven orange-red by its own live frame `[dimmer 100, R 63, G 27, B 0]`.
  **What actually changed is halo GEOMETRY:** `_73` made the DMX halo a rim
  multiple of the drawn bulb and `_75` unpinned it, taking a par's halo from
  **0.98× its bulb** (buried inside the can — drawn every frame, invisible every
  frame) to **2.12×** at his settings (measured rBulb 0.2223 / rHalo 0.4713
  against a 0.225 housing radius). The red was always painted; the ring is new
  because the rim finally reaches outside the housing. It reads as "black housing
  + red ring" because the two layers share a colour but not a material — an
  opaque core REPLACES the background and reads as body, an additive rim ADDS and
  reads as light. **No colour, halo or sACN code was changed.** Instead the one
  genuine inconsistency is surfaced as **item 26**: three unmapped-indicators
  exist, two obey "Show Unpatched (Red)" (currently OFF) and
  `paintUndrivenEntry` does not — leave / gate / bulb-only, his call, one line
  either way. **Bug 2 closed by his own follow-up** (*"sorry, I was using the LED
  halo size, not the global one in options"*): no DMX reach defect, `_75`'s
  liveness stands, and the same probe re-confirmed all six classes moving under
  Global Halo Size in the `full` profile. That name pair has now cost two
  debugging rounds in one day, so **label/tooltip hardening shipped** (no
  behaviour change): `Pixel Size` → **`LED Pixel Size (LED only)`**, `Halo Size` →
  **`LED Halo Base (LED only)`**, plus reach tooltips on all four halo/size
  controls including the auto-built globals (defined in code — `common.yaml` is
  operator-owned and was not written). Merging the two knobs was considered and
  rejected: they are different quantities (absolute LED radius vs rim
  multiplier) and `_77`'s three-factor model needs both — naming was the defect.
  **+5 tests** pinning halo-follows-bulb on every driven entry point per class,
  the undriven-red indicator reaching BOTH layers, the halo material staying
  white, and PERF P0 (50 recolours add no scene objects, materials reused, halo
  stays one InstancedMesh). **Suite 1316 / 1307 / 9, zero new failures from this
  work** — the 9th is `_76`'s scene-data-driven orphan test failing on the
  operator's OWN edit (`'Left Center Auditorium' no longer exists in the scene at
  all — drop it from ORPHAN_GROUPS`): he deleted the Left Center Auditorium
  ghosts, so **waiting item 4 is DONE** and `_76` owes its list a one-line
  update.

- 2026-07-30 — **PER-FIXTURE LOCAL HALO SCALE — base × global × local (`_77`;
  sim halo recipe + fixture runtimes + GUI, LANDED).** Operator, ruling on
  item 24: *"Each fixture having a local override sounds good for the halo, but
  an overall global halo too would be nice — local is maybe a scale for the
  global?"* + *"LED fixtures, DMX fixtures are both fixtures, keep that in mind
  please."* **The model is now three factors:**
  `effective halo = (class base) × Global Halo Size × config.haloScale`, where
  the class base is `params.ledHaloSize` (absolute) on the LED bus and
  `drawnBulb × dmxHaloRimMultiple` (a rim) on the DMX bus. **Item 24 is resolved
  by this design, NOT by merging knobs** — Global Halo Size stays the one global
  (`_75`), the LED folder's Halo Size stays the LED-bus base radius, and the new
  local scale multiplies on top of both. **"Both are fixtures" taken literally:**
  ONE property name (`haloScale` on the fixture config), one resolver
  (`resolveLocalHaloScale` in `led_halo.js`, the module that already owns the
  shared halo recipe), one persistence shape, and one `Halo ×` slider (0.1–10,
  step 0.05) in BOTH places fixtures are edited — the per-fixture folder in the
  DMX/par list (which ALREADY serves the LED-bus TE Sign / LED Grid panels, since
  those live in `parLights` and are built by `DmxFixtureRuntime`) and the
  per-strand folder in the LED Strands list. **Bulk-set across a selection comes
  free** via the existing `propagateToSelected` — no new group machinery, per the
  brief. **Defaults are a perfect no-op:** absent or 1.0 ⇒ byte-identical
  rendering (tested across every registered class), so every pre-existing scene
  is untouched; lil-gui needs a bound property so opening a folder seeds
  `haloScale = 1` exactly as `diffusionAmount`/`scaleX` already do — identity
  value, no autosave, reaches disk only on HIS next save. **Validation is loud
  and nothing is silently clamped:** absent ⇒ 1.0 (defined default), present but
  not a positive finite number ⇒ THROWS naming the fixture; the UI bounds input
  to 0.1–10 but the resolver never clamps, and the only bound on a RESULT is the
  `_75` halo pitch ceiling. **Cap behaviour:** the ceiling runs AFTER the local
  multiply, so an override can widen a rim but can never reopen the smear hole —
  at `Halo × 10` the bar pins at 0.0825 and the vintage at 0.28125
  (`pitch × 1.5`), exactly at and never past; single-pixel pars have no ceiling
  and are linear everywhere; and the cap does not swallow the control (a 1.3×
  override on the vintage is still visible at his settings). **Live path:**
  `syncFromConfig` now also refreshes bulb/halo instance matrices — it already
  refreshed CONE matrices but not the emitter radii, which is why a config-driven
  halo would otherwise have sat in the config and never reached the screen;
  discrete edit paths only (drags call `updateVisualsFromHitbox` directly) so
  **zero per-frame cost**. Strands use `applyVisualSize` (the same entry point
  `_75` wired). **Live-verified in his running sim: `Halo × 2` exactly doubles the
  drawn halo on all six classes** (par 0.471→0.943, TE Sign A/B 0.196→0.392, bar
  0.0350→0.0700, vintage 0.1193→0.2385, strand 0.196→0.392) with **0 sACN-OUT
  enables, 0 save-server requests** and every touched config key restored
  (including deleting keys that were never there). **+10 tests, all passing,
  zero new failures from this work**; suite reads 1298/1289/9 because **`_76`
  landed concurrently** (+51 tests and one failure of its own — the orphan-group
  test in `pixel_map_view_defaults.test.js`, no halo code in it). **Two
  deliberate calls flagged, not silently taken:** (a) fog/haze machines show the
  `Halo ×` field but render no halo in any profile — uniformity was the explicit
  order, so it is reported rather than omitted; (b) LED-bus halos still have NO
  pitch ceiling, against the brief's "both bounded" line, because that is the
  established design (a sign's halos are MEANT to merge, `_49` pins it, and
  clamping would cut the TE Sign's verified 0.7 halo to 0.25). Both are
  one-liners if he wants them changed.

- 2026-07-30 — **ORPHANED FIXTURES ARE FLAGGED AND REMOVABLE IN THE SIM
  (`_76`; new pure detector + pixel-map removal primitives + GUI, LANDED).**
  Operator: *"there are some fixtures without corresponding generators, please
  flag those in the sim and allow removing them one by one or group by group."*
  **The rule, stated once and tested:** a fixture is an ORPHAN when it CLAIMS
  generator origin (`traceGenerated === true`, strictly — `'true'`, `1`,
  `undefined` are unknown provenance and never a claim) AND no live trace owns
  its group, where ownership is keyed on `trace.groupName || trace.name` so a
  RENAMED generator never false-positives its own live run. Hand-placed
  fixtures and the `traceGenerated: false` TE Sign halves are never flagged; a
  scene whose generator list cannot be read is **not scanned at all** (throws)
  rather than reporting every generated fixture as ownerless.
  **"Both are fixtures" taken literally** (the same ruling `_77` follows): the
  scan walks `parLights` AND `ledStrands`, one rule, one badge, one confirm
  dialog, one delete path — the bus is *reported*, never a branch — and group
  membership is counted across both buses because groups share one namespace.
  **Flags:** `📐 Group Generator ⚠ N orphaned fixtures` on the section header
  (the right home — an orphan's defining property is having NO card in that
  list) plus a banner with a `🗑 Remove N` per affected group; red badges on
  the group folder header and on each fixture row; a warning bar with
  `☑ Select N` (reuses the existing selection highlight, no new render
  machinery) and `🗑 Remove N orphan(s)`; and `🗑 Remove this orphan` inside
  each orphan's card — the control that did not exist, which is precisely why
  the Left Back Wall 5 needed coordinator scene surgery.
  **Every delete enumerates its dependents FIRST** (`_47`'s ethos): controller
  chain entries with controller/IP/port/universe/address, patch-tree records,
  live-vs-zeroed patch fields, 2D Pixel Map name selectors + move offsets +
  placements, group membership and whether the group disappears (naming the
  `{group: …}` selectors that then go zero-match — enumerated, never
  rewritten), and the exported engine-model pixel footprint. The confirm dialog
  IS that enumeration; the question comes last. **Four loud refusals, zero
  mutations:** a candidate that stopped being an orphan under the dialog (one
  bad row aborts the WHOLE operation — no "delete the ones that still
  qualify"), a row unresolvable by config identity, an unreadable dependent
  store or unbound runtime fixture (the model footprint is refused, never
  guessed), and a removal that would leave a 2D panel with an empty `select`.
  **Nothing is written to disk** — the removal mutates memory and marks the
  scene dirty; HE saves and HE re-exports, said in both the dialog and the
  toast. **Proof:** 64 new tests (41 behaviour + 23 wiring, run green), suite
  **1311 / 1302 / 9** vs a session baseline of **1237 / 1229 / 8** — same 8
  known stale-model failures; the 9th is a concurrent agent's brand-new
  `pixel_map_view_defaults.test.js` pinning the ghost count at 7 while the
  operator's 14:28 save deleted `Left Center Auditorium 5`, so the scene now
  carries **6** (left alone per the concurrency rule; needs `7`→`6` or, better,
  the count assertion dropped since that number is now operator-controlled).
  The detector run against read-only copies of all three real scenes reports
  **titanic 6 / test_bench 0 / studiodj 0** — zero false positives across 124
  fixtures and 12 strands. Report `20260725_76_orphan_fixture_removal_ui.md`

- 2026-07-30 — **GLOBAL HALO SIZE IS NOW ONE KNOB FOR EVERY BUS (`_75`; sim
  render path + GUI wiring, LANDED).** Operator: *"The halo size parameter only
  affects the TE sign lights, no LED strands, none of the DMX lights."* →
  *"please make sure that's a global for-all-fixtures parameter."* **Two
  independent defects, one per bus**, measured live in his running sim
  before/after with a readonly-guarded probe (his settings: Global Pixel Size
  1.9, **Global Halo Size 1.4**, ledPixelSize 0.08, ledHaloSize 0.14).
  **(1) REACH —** the `globalHaloScale` handler iterated `parFixtures` +
  `dmxSceneFixtures` and stopped; LED strands are a separate list with a separate
  re-render entry point (`applyVisualSize`) and were never called, so their halo
  (`ledHaloSize × globalHaloScale`) was **frozen at build time**: 0.196 → 0.196
  across the whole slider. A reload applied it; the knob never did. **(2)
  CEILING —** a DMX halo was bounded by the **opaque bulb's** pitch ceiling. A
  multi-pixel fixture's bulb sits AT that ceiling (`0.3 × pitch`) at any normal
  pixel size, so the halo collapsed to `bulbCeiling × HALO_RIM_FACTOR` and
  **stopped answering the knob from haloScale 1.0 up** — he is at 1.4, i.e. past
  the stall: vintage 0.0608→0.101 and bar 0.0178→0.0297 and then nothing. The
  single-pixel par escaped (pitch 0 ⇒ no ceiling), which is why "none of the DMX
  lights" held for the rails and bars but not literally everything. **The TE
  sign is the one class BOTH defects skipped** (LED-bus ⇒ absolute radius, no rim
  arithmetic, no ceiling; not a strand ⇒ not missed by the handler) and it has by
  far the loudest response (halo/bulb 0.37→18.4 vs the DMX rim's 1.08→5.0) —
  hence "only the TE sign". **Fix:** the halo gets its OWN, looser pitch ceiling
  (`MAX_HALO_PITCH_MULTIPLE = 1.5` + `clampHaloRadiusToPitch` in `led_halo.js`),
  because the two ceilings bound different things — the bulb cap protects OPAQUE
  cores (a real defect, `_53` intact), while additive halos are *meant* to merge
  (every LED-bus fixture does it on purpose and the strands he calls correct run
  a halo ~0.7× their own pitch). **1.5 is derived, not taste:** a bulb at its cap
  × the max rim multiple is `0.3 × 5.0 = 1.5 × pitch` — the smallest ceiling that
  lets the knob reach its top end at all, and there is a test asserting that
  inequality so it can never be tightened back into a stall. The slider handler
  now also pushes `applyVisualSize()` to strands; the strand **bulb** is
  `ledPixelSize` and ignores `globalPixelScale`, so **decision item 11 is
  untouched** (tested). **After:** all six classes MOVE 0.1→5 —
  strand 0.014→0.700, vintage 0.0608→**0.281**, bar 0.0178→**0.0825**, par
  0.240→1.112, TE sign 0.014→0.700 — verified in his live sim with **0 sACN-OUT
  enables and 0 save-server requests**, params restored. **Caps are stated, not
  silent:** nothing is capped below the slider max; at exactly 5 the vintage
  (0.28125) and bar (0.0825) touch `1.5 × pitch`, pars and LED-bus never do. At
  his 1.4 every DMX class now reports the same 2.12 halo/bulb ratio. **Profile
  note (`_74`):** halos exist only where emitters are built — `full`/`emissive`
  yes, `pixel_mapping`/`edit`/`2d_pixels` have no halos for ANY class, so the
  knob is correctly inert there. Coordinator's "does the new dot layer have its
  own halo?" — checked and cleared: it is one opaque sphere per pixel answering
  Global *Pixel* Size only. **Suite 1237 / 1229 / 8** (+5 tests, zero new
  failures); `dmx_halo_visibility`'s "cannot smear" test re-pointed at the halo
  ceiling (a deliberate rule change, documented in the test body — the bound is
  still real and still tested). **Live on the drag, no reload needed.**

- 2026-07-30 — **"ONLY LEFT FRONT RAILS": THE SCENE-WIDE DOT MESH NEVER SAW THE
  RENDER SCALE (`_74`; sim render path only, LANDED).** Operator, with a
  screenshot: *"the vintage lights are still bad… funny thing, it's only Left
  Front Rails so I think it might be a lingering cache somewhere, try to
  regenerate the instances quickly and let me check."* Commissioned as a **cold
  review**; it **supersedes `_68`'s addendum**. There is no cache and it is not
  brightness. There are **two** emitter layers over every pixel and only one was
  fixed: (1) the per-fixture instanced bulb/halo — which `_68` scaled correctly
  and whose live probe of all 16 vintage fixtures was accurate; and (2) the
  **scene-wide instanced-dot mesh** in `animate.js`, ONE `InstancedMesh` over
  every pixel in the show (971 on titanic), which placed and sized its dots from
  the pixel map's **PHYSICAL** `x/y/z` + `pixelSize` and never saw
  `fixture_model_scale.js`. `_68`'s probe could not have seen layer 2 —
  `_pixelInstancedMesh` is module-private and parented straight to the scene, not
  reachable from a fixture. **The asymmetry is the colour flush:** every
  *unpatched* dot is forced black (or overlay-red), only a *patched* dot shows
  its live colour — so the pre-scale dots were visible on exactly the **Left
  Front Rails, the only patched vintage run** (U23, addr 1/34/67/100). Every
  vintage fixture's dots were wrong; four were lit. In the `pixel_mapping`
  profile the per-fixture emitters are **not built at all** (verified live), so
  layer 2 is the only emitter and `_68`'s 2.5× was fully invisible. Head dots
  went from spanning 375 mm inside a 1150 mm housing to **937 mm**, radius
  0.0198 → **0.0495** (par 0.0429 → **0.1287**). **Fix:** the pixel map now
  emits **runtime-only** drawn geometry (`rx/ry/rz` = `localPos × renderScale`
  through the world matrix, `renderScale` from the one
  `fixtureModelScale` table) beside the untouched physical fields — the
  exported Pixelblaze model is **byte-identical** (new fields are not in
  `saveModelJS`), and `x/y/z` + `pixelSize` still feed the engine, sACN
  patching, `_batchCoords`, the 2D Pixel Map and the light pool. New
  `simulation/src/core/pixel_dot_geometry.js` is the ONE drawn-dot recipe and
  **throws** on physical-only data (codex P0, no silent fallback); all **three**
  dot writers in `animate.js` (cache build, slider hook, per-frame isolation
  flush — three independent copies of the same formula) now route through it.
  **Zero new scene-graph objects** — same mesh, same instance count, different
  numbers in existing matrices. **Suite 1232 / 1224 / 8** (+8 tests, zero new
  failures — the same known stale-model/parity 8). New tests pin: a driven DMX
  frame never moves or resizes ANY instance matrix (the "live frames clobber the
  scaled matrices" theory, killed and kept dead); the 2.5×/3.0× floors on the
  dot layer; the loud-throw on physical-only entries; a real rotated fixture
  exporting physical `x/y/z` **and** drawn `rx/ry/rz` matching its own
  `renderPos`; strands and unscaled types at exactly 1:1. **Proof:** new
  `agent_tools/patched_dot_scale_capture.cjs`, readonly-guarded with the
  `vintage_sizing_capture` guard set (`__readonlyMode` accessor, :6972 socket
  refused, save-server requests counted) — ran against his live stack with
  **0 sACN-OUT enables and 0 save-server requests**; `before_prefix_dots.png`
  reproduces his screenshot almost pixel-for-pixel (tiny dots at one end of a
  big dark housing) and `after_fixed_dots.png` shows them filling it. Captures
  in `~/tmp/patched_dot_scale/`. **He sees it on one hard reload** (item 23) —
  no server restart, nothing in his session touched.

- 2026-07-30 — **PAR CANS AT 3×, AND EVERY DMX FIXTURE'S HALO IS FINALLY A RIM
  (`_73`; sim render path only, LANDED).** Operator: *"do the same 3X
  enlargement for the par can Uking pars"* + *"make sure all DMX fixtures have
  the halo, if it's not hurting performance. High FPS is a must now."*
  **Pars:** type key **`UkingPar`** (47 on titanic — the most numerous fixture
  and the smallest single emitter); `FIXTURE_MODEL_SCALE.UkingPar = 3.0` — can
  150→**450 mm**, depth 120→**360 mm**, bulb radius 0.039→**0.117**;
  single-pixel so the pitch ceiling never applies and the 3× is exactly what is
  drawn at any slider. Same invariants as the vintage 2.5× (physical `localPos`
  untouched, clamp on drawn spacing, instancing preserved, floor-guard test at
  3.0). **Halos: they were never missing — they were drawn INSIDE their own
  bulbs.** Bulb was `physicalBulb × modelScale × pixelScale`, halo was
  `physicalBulb × 1.8 × haloScale` — two different sliders on the two radii, so
  the rim sinks into the core whenever `haloScale < pixelScale/1.8`. At his live
  settings (1.1 / 0.6, threshold 0.611) a par's halo was **0.98× its bulb**:
  drawn every frame, invisible every frame — and model-scaling made it strictly
  worse. Now the DMX halo is a rim **multiple** of the bulb as drawn
  (`dmxHaloRimMultiple`, in `led_halo.js`): ≥1 at every setting, byte-identical
  to the historical `bulb × 1.8` at the shipped default, same single global
  knob, still bounded by `_53`'s pitch ceiling, **LED-bus halos untouched**
  (`_49` parity suite passes unmodified). His pars go 0.98× → **1.48×**.
  **PERF GATE PASSED, discrete GPU verified** (`ANGLE NVIDIA RTX 4090 Laptop`,
  `integrated:false`): scene-object census **byte-identical** before/after
  (1735 objects / 292 InstancedMesh / 3626 instances / 224 sprites / 891
  meshes) — the halo batch already existed, only radii changed, **zero new
  scene-graph objects**; controlled within-session A/B **halos-off 30 FPS vs
  shipped 30 FPS**, and even a 2.6× rim (5× beyond anything shipped) costs ~4
  FPS against ±15 FPS session drift. Between-session medians 45/43 before, **49
  after**. **Suite 1222 / 1214 / 8** — same known stale-model failures, zero
  new; **+8 tests** (every DMX type at 5 slider settings must draw its halo
  strictly outside its bulb; the par regression with his exact numbers; the
  dense-bar ceiling; LED-bus unchanged; halo-is-one-InstancedMesh guard; par
  3.0 floor + cylinder housing/no-clamp). Proof capture inspected
  (`.agent_renders/1785443017_par_cans_3x_halo.png` — cores measure exactly the
  predicted 0.26 m); the contention banner was present, so that was the single
  authorized capture and browser work stopped there. Report:
  `202607/20260725_73_uking_par_scale_halos.md`.

- 2026-07-30 — **THE PER-OUTPUT PUSH IS REBOOT-AWARE, AND A TIMEOUT IS NO
  LONGER A VERDICT (`_69`; code + unit tests only — no browser session, no
  server start, no device HTTP, no scene write, no git ops: the operator was
  running lit hardware off this sim).** His report: *"✋ per-output push failed:
  timed out after 5000 ms — device did not respond … the restart takes much
  longer for the config reset, can it be fixed in the LED controller pane?"*
  **Root cause: one flat `DEFAULT_HTTP_TIMEOUT_MS = 5000` covered every phase**,
  including the `POST /api/config` that makes the device REBOOT — measured
  ~10–11 s (`_56` addendum), and the firmware drops the reply on the way down.
  So the push aborted mid-reboot on perfectly healthy hardware, and then did the
  worse thing: it declared **failure over a device it had just written**, and
  returned before the reboot wait, the read-back, the save and the notify —
  leaving the mirror claiming "not written" over written hardware (the exact
  mirror-vs-device lie this wave exists to kill). 5000 ms also sat right on the
  ~5 s cold-first-byte number, so plain reads were a coin flip too. **Fix:**
  three named, measured, exported phase budgets — write
  `PER_OUTPUT_WRITE_TIMEOUT_MS = 12000`, reboot wait
  `REBOOT_WAIT_TIMEOUT_MS = 45000` (poll `/api/status` with progress copy in the
  dialog: *"device rebooting — waiting up to 45s for it to answer (Ns
  elapsed)…"*), read `DEFAULT_HTTP_TIMEOUT_MS = 8000` — and
  `pushPerOutputUniverses` now **refuses a flat `timeoutMs`** so the bug cannot
  be reintroduced. **A lost write reply is now arbitrated by the read-back, not
  by the clock:** an unanswered POST is tagged `writeResponseLost` (a device
  that ANSWERED 400/5xx stays a definite failure via `err.httpStatus`), falls
  into the same reboot wait, and then reads the config back — matching plan ⇒
  SUCCESS that says *"the write reply was LOST … but the read-back confirms the
  mapping applied"* and proceeds to save + notify; a different mapping ⇒ drift
  failure; never answering ⇒ *"the write is UNCONFIRMED: it may or may not have
  applied"* (never "it failed"). S1's per-step dialog and S2's pre-write gate
  are untouched; the fleet push rides the identical core (pushed-with-note vs
  failed-loudly). **Suite 1174 / 1166 / 8** — same 8 known stale-model failures,
  zero new; **+13 tests** (7 flow, 6 transport), none of which sleeps a real
  budget. **Operator action:** re-run the push that failed — expect the
  reboot-wait progress then green; and check that card's sync chip first to see
  whether his failed attempt already left the device ahead of the mirror
  (`in-sync` ⇒ it did; either way, ⬆ Push again finishes the loop). Report:
  `202607/20260725_69_push_timeout_reboot_aware.md`.

- 2026-07-30 — **PORT → PHYSICAL-OUTPUT ASSOCIATION: IMPLEMENTED +
  VERIFIED (`_71`; code + unit tests only — no browser session, no scene
  save, no device HTTP, nothing restarted, no git ops).** `_70`'s design
  built, rebased on `_69` and composed with `_59`/`_61`. An LED card port
  now **declares** the physical board output it drives (`output:`,
  1-based, on the port row); the device's 0-based `strands[]` index is
  derived at the device boundary only, in the single new
  `ledOutputIndexForPort`. Absent ⇒ **identity** (`output = port`),
  materialized at load with one log line per card; a bad type/range
  hard-stops the boot; a **duplicate loads** (fixable in the pane) and is
  refused by the push. **The push never writes `enabled: false`** — an
  enabled output no port drives is **PARKED** on a claims-free universe
  (subscribed, unrouted, dark), persisted as `parkedOutputs:` on the card
  so it is sticky and the chip stays quiet on a card nobody touched, and
  re-derived only when it is claimed / collides / falls outside the ≤16
  window (an exhausted window REFUSES rather than parking outside it).
  The one asymmetric write is **enable-only**: a port with mapped pixels
  driving a board-disabled output turns it ON with its pixel `count`,
  declared per output in the confirm dialog under its own heading;
  `count` on an already-enabled output is never rewritten. Uniqueness is
  enforced twice — the selector renders a taken option disabled
  (`3 — taken by P2`) and `onchange` reverts, and the push gate blocks
  regardless of who authored the file, with **zero** device writes.
  Three new blocking refusals join `_59`'s channel (`duplicate_output`,
  `output_out_of_range`, `parked_span`) on ONE refusal surface. The three
  downstream holes `_70` found are closed: the LED claim label now reads
  a separate `portNum` (it named the wrong card port under a crossed
  mapping), `lib/bench_section.cjs` compares against the DECLARED output,
  and `collectClaimedUniverses` now indexes other cards' **strandless
  port universes** and **parked universes** — both universes a device
  really subscribes to and neither visible in the strand projection.
  `_69`'s read-back helper was **extended in place, not forked**, so the
  lost-reply arbitration now covers the full map (assigned + parked +
  pending enables) and a missing enable is named specifically. Sync chip
  compares that same full map with the same claims and the same derive as
  the push, so chip and push can never disagree. UI: `▾ P1 → out[4▾]
  U[21]` per row with a crossed-mapping accent + collapsed-summary marker
  (`· P1→O4`), a card-level `Board outputs: 1←P1(U21) 2←P2(U22)
  3 parked U27 4 disabled` line with `↻ re-park`, and a memory-only
  `deviceOutputsCache` feeding the selector (never persisted — a stale
  on-disk output count would silently constrain the selector on a machine
  that never talked to the board). **Suite 1184 → 1224 / 1216 pass /
  8 fail — +40 tests, zero new failures**, still exactly the known
  stale-model family; `node --check` clean on every touched file. Five
  documented deviations from `_70`, the load-bearing one: **an EMPTY port
  row pointed at a DISABLED output enables nothing** (the design's rule
  as written would have added it to the enable list, then refused for
  `count < 1` — i.e. every routine 4-row card driving two strands would
  have failed to push). One firmware assumption stays UNVERIFIED and is
  called out in the report: what `sacn.perOutput` reports for a
  parked-but-enabled output; the verify asserts the planned universe
  there, so a mismatch fails loudly at read-back rather than silently.
  **Expect the `.60` to read ▲ Drift on load — ONE push re-parks output
  3 off U23** (waiting item 15/18). Operator-gated live checklist (6
  steps, not executed): `_71` §6. Report:
  `202607/20260725_71_port_output_assoc_impl.md`.

- 2026-07-30 — **PORT → PHYSICAL-OUTPUT ASSOCIATION: DESIGN LANDED (`_70`;
  design only — read-only against every source file, no code, no device HTTP, no
  browser session, no git ops).** Operator order: let him choose which board
  output each LED card port drives, keep the outputs right on push, no repeating
  associations, and have an agent verify the workflow. **Mid-design he revised
  the push half** — *"the controller can have all 4 ports enabled at all times,
  and we just direct data to the port we need"* — so the design **parks instead
  of disabling**: the push NEVER writes `enabled: false`; an output with no card
  port keeps its enable state and gets a **parked universe** the `_59` claims
  gate proves is free, and since relay routes are unicast per (universe, IP) and
  no patch record points at it, nothing ever routes there — the output stays dark
  with zero traffic and zero reboot churn. **This supersedes `_59`'s auto-extend**
  for portless enabled outputs (same mechanism, now named, persisted and sticky);
  the claims gate, the required claim index and the blocking refusal are kept.
  The `.60`'s U23 landmine retires by **re-parking**, not by disabling. Data
  model: an explicit 1-based `output:` on each LED port row (`controllers.yaml`
  round-trips it free — the save server dumps the live registry — but the LOADER
  drops unknown port keys today, so parsing it is the actual work), migrating as
  **identity** (`output = port`) with one log line per card. Downstream truth
  found: `outputIndex` **does** reach `patches.yaml` per strand, its meaning stays
  "physical output"; the LED claim label at `led_patch_projection.js:310` derives
  the card-port number from it and would name the WRONG port under a crossed
  mapping (needs a separate `portNum`); and `lib/bench_section.cjs:277-280`
  hardcodes `outputIndex === port.port - 1`. One asymmetric write survives,
  **enable-only**: a port targeting a board-disabled output turns it ON (with its
  pixel `count`), declared in the dialog — that is what makes his "drive output 4
  from ONE row, no filler rows 1–3" work end to end; already-enabled outputs never
  get their `count` rewritten. Uniqueness enforced twice (selector cannot express
  a duplicate + blocking push refusal, S2-style, joined by an out-of-range refusal
  vs the board's real output count and a parked-universe span/exhaustion refusal).
  Sync chip now compares the FULL map (assigned + parked + pending enables) —
  expect the `.60` card to read `▲ Drift` the moment this lands, which is the
  landmine finally becoming visible. Deliverables: 25-case unit matrix, an
  operator-gated live checklist, and a 10-step ordered brief for `_71` (queued
  behind `_69`, whose read-back path it must EXTEND, never fork). Report:
  `202607/20260725_70_port_output_assoc_design.md`.

- 2026-07-30 — **VINTAGE LIGHTS NOW RENDER AT 2.5× IN THE 3D SIM — HOUSING AND
  PIXELS (`_68`; sim render path only, LANDED).** Operator: *"the vintage lights
  are still tiny in the 3d vis — please make sure they are scaled up model-wise
  by 2.5X at at least (housing and pixels)."* **Root cause: nothing in the sim
  ever drew a physically small fixture bigger than it is.** The fixture is
  90 × 460 × 60 mm with six 18 mm heads on a 75 mm pitch, on a ~100 m ship.
  `_53` could not have fixed it — its whole mechanism is a **ceiling**
  (`clampPixelRadiusToPitch`), which can only shrink; at his own sliders `_53`
  reported the vintage light pixel-identical. New
  `simulation/src/fixtures/fixture_model_scale.js` holds a per-type render
  multiplier (`VintageLed: 2.5`, frozen, validated at import, throws on garbage)
  applied uniformly in `dmx_fixture_runtime.js` to housing box + offset, hitbox
  dimensions, per-pixel `bulbSize`/halo, and a new `renderPos` used by every
  emitter/cone matrix — drawn housing 225 × 1150 × 150 mm, drawn head pitch
  187.5 mm, bulb radius 0.022 → **0.055** at his Global Pixel Size 1.1.
  **`localPos` stays physical on purpose** (the Pixelblaze model exporter and
  light_pool sample it — an exported model must describe the real rig).
  **Clamp trap avoided:** the pitch ceiling is now measured on the DRAWN
  spacing; left physical it would have silently clamped the whole 2.5× back to
  the old size at any slider above 0.45, i.e. at his 1.1. Anti-fusion guarantee
  intact, instancing intact (one InstancedMesh per emitter layer, asserted).
  Zero writes to `scenes/**`, fixture model YAML, `marsin_engine/**`,
  `pixel_map/**` or `gui_builder.js`. **Suite 1161 / 1153 / 8** — same 8 known
  stale-model failures, zero new; 7 new tests. Visually verified in ONE
  read-only pass (`?readonly=1`: no sACN out, no pattern engine, no saves) —
  the six heads now read as ~0.10 m spheres in a spaced column. **Flag for
  Sina:** close views are dominated by the chain-order/trace **editing overlay**
  (~1.6 m translucent discs + red dotted wire lines drawn over every fixture) —
  GUI → Generators → "⛓ Show Chain Order" turns it off; much of the "tiny red
  dots" clutter is that overlay, not the fixtures.
  **ADDENDUM (same day, operator: *"Left Front Rails 4 still show small pixels
  … make sure this is a global change"*, then *"these are fine though — Left
  Back Rails 4"*):** it IS global and Left Front Rails 4 has it. A read-only
  probe of his running sim measured **all 16 VintageLed fixtures identical** —
  `_modelScale` 2.5, drawn bulb radius 0.055, drawn pitch 0.1875, head column
  0.9375 m — front/back/port/starboard, same class, same YAML section, entries
  byte-identical apart from position/rotation. **The difference is brightness,
  not size:** the Left Front Rails (U23, LeftFrontDeck) are the **only patched
  vintage run**, so they render live DMX (two of four probed near-black) while
  every other vintage fixture is unpatched and holds its full static colour —
  and apparent size at night is carried by halo + bloom. Registry audit: exactly
  ONE vintage class (16 instances), legacy `ModelFixture` path unused on
  titanic, **no non-vintage type scaled** (the "report, don't act" gate never
  triggered). Code unchanged; **+2 regression tests** (every vintage entry in
  his real scene collapses to ONE size signature; any future `/vintage/i` type
  must carry a ≥2.5× scale). **Suite 1176 / 1168 / 8**, same known failures,
  zero new. **Visual verification ABORTED** — the capture came back showing the
  sim's *"⚠ 2 sim windows connected — hardware output contention risk"* banner,
  so browser work stopped there; the numeric probe is the evidence (0
  save-server writes, sACN out pinned off). **Back to Sina:** if the front rails
  should be lit, check what U23 is sending the LeftFrontDeck chain (same feed as
  `_56`/`_58`/`_60`); to make all vintage lights read bigger regardless of level
  the lever is **Global Halo Size** (0.6 today), not model scale. Report:
  `202607/20260725_68_vintage_3d_scale_up.md` (+ addendum).

- 2026-07-30 — **2D PIXEL MAP: THE EDIT-TAB ARRANGEMENT NOW SURVIVES A RELOAD,
  AND AUTO-SAVES ITSELF (`_66`; code + unit tests only — no browser session, no
  server start, no device HTTP, no scene write, no git ops: the operator was
  running lit hardware off this sim).** His report: *"I edited the arrangement
  in the 2d pixels and saved all the way but the reload of server ruined them
  again!"* **Root cause: his layout never reached disk. Not once.**
  `params.pixelMapViews` — panels, hand-placed anchors, per-view framing, every
  EDIT-mode offset — was a params key with **no YAML wiring at either end**:
  `src/core/config.js` only ever knew the *retired* `pixelMap2d`, so
  `reconstructYAML` never wrote it into the config tree (and never creates a key
  that isn't already there) and `extractParams` never read it back. A full save
  wrote the whole scene without the layout; the next boot found nothing
  persisted, re-seeded the four shipped defaults, and the arrangement was gone —
  silently, with disk and UI both looking healthy. Reports `_54`/`_55` both
  claimed persistence rode "commitViews → params.pixelMapViews → his own Save";
  that last hop did not exist. **Fix:** the layout gets its own scene sidecar,
  `scenes/<scene>/pixel_map_views.yaml`, written through a new
  `POST /save-pixel-map-views` (validate → snapshot → atomic write; a malformed
  body is a 400 that touches nothing) and parsed at boot in `main.js` exactly
  like `views.yaml` — **a corrupt file HALTS the boot**, because booting past it
  would seed the defaults and let the auto-save write them over his file.
  **Auto-save (his explicit order):** `commitViews()` now debounces 800 ms onto
  that one endpoint, always sending the LIVE container, with a `sendBeacon`
  flush on unload so "move it, then reload" can't outrun it. **Scoped — and a
  widening that was already happening got removed:** `commitViews` used to call
  `window.debounceAutoSave(true)`, a FORCE that bypassed his deliberate
  `autoSave: false` and dragged fixtures, patches, model + engine sidecars to
  disk from a pan or a drag — while still not saving the layout. Gone, along
  with the scene-dirty mark (the chip would now be lying); a test scans the whole
  `src/gui/pixel_map/` dir to keep it that way. Failures are **loud**:
  `⚠ PIXEL MAP LAYOUT NOT SAVED — <verbatim reason>` via `showSaveToast(msg,
  true)` + `console.error`, and a garbage views tree refuses to write rather than
  overwriting a good layout. **Suite 1154 / 1146 / 8** — the same 8 known
  stale-model failures, zero new; **20 new tests** (round-trip through the real
  YAML dump/load, YAML-hostile fixKeys, the seed guard never clobbering a
  persisted layout, burst→one-write debounce, latest-wins, loud 500, unload
  beacon, the scoping scans, client↔server↔boot agreement, recoverability).
  **Operator must restart the sim server once** for the new save route to exist;
  live checklist in the report §7. Report:
  `202607/20260725_66_pixel_edit_persistence.md`.

- 2026-07-30 — **Security redaction sweep landed (`_67`)** — the uncommitted
  `.agent/` wave was carrying 50 `bm26-report-ip` findings (internal IPs in
  prose/URLs/log pastes, two UNC paths naming the show host) that would have
  blocked the next commit at the pre-commit gate. All 50 redacted to the
  `10.x.x.NN` / `\\<show-machine>\…` convention across 13 reports plus this
  doc and the thread tracker — identifiers only, no factual claim changed.
  `security_check.py --all` now reports **zero** `.agent/` findings; the 6
  that remain are device MACs inside gitignored, operator-owned
  `simulation/.scene_backups/` snapshots, which can never be staged.

- 2026-07-30 — **LED GAMMA UI LANDED: THE TEXTBOXES ARE GONE, IT IS A CURVE
  CONTROL NOW (`_65`, implements `_64`; code + unit tests only — no browser
  session against the sim, no scene save, NO device HTTP at all (not even a
  GET), no restarts, no git ops — the operator was running lit hardware).**
  Every LED controller card in the Controllers panel now carries the
  firmware-style control: **four R/G/B/W sliders** (1.00–3.00, step 0.05,
  channel-coloured, read-only 2-dp readouts), a **Link RGB** checkbox **on by
  default** (W never linked), three **preset chips** — `Off` 1/1/1/1,
  `2.2 sRGB` = `LED_GAMMA_RECOMMENDED`, `Punchy` 2.6/2.6/2.6/1.0, the active
  one lit — and a **live inline-SVG plot** (132 × 84) of all four `y = x^γ`
  curves over a quarter grid with the **dashed identity diagonal**, the
  **1/255 video clamp** drawn honestly, and a **dashed ghost of the last
  hardware-verified curve** whenever the mirror has drifted (the drift chip's
  warning, made visible). Caption: `y = x^γ · applies live — no reboot`.
  **Presentation only** — the mirror, `parseGammaField` /
  `validateGammaMirror` (1.0–3.0, throws loudly), the gamma-only push, the
  read-back verify, `commitGammaPush`, the fleet run, the provenance chip and
  the red error line are byte-identical. `oninput` repaints a local draft
  (no mutate, no scene write, no refresh — a drag never floods undo);
  `onchange` validates through the one source and commits **exactly one**
  `ctx.mutate`. Link-RGB state is ephemeral UI state, never written to
  `controllers.yaml`. Curve maths lives as pure DOM-free exports in
  `led_gamma.js` (`quantizeGamma` — snaps to the grid **and** 2 dp, **never
  clamps**; `gammaCurvePath`; `LED_GAMMA_PRESETS`; `GAMMA_CURVE_GEOMETRY`;
  `activeGammaPresetKey`), so the plot is unit-tested with no DOM. Inline SVG
  via `innerHTML` (the codebase convention) — no library, no CDN, no font, so
  offline P0 holds by construction. Files: `led_gamma.js` (additive only),
  `led_gamma_ui.js` (`renderGammaSection` body; both push functions and both
  `controller_map_editor.js` call sites byte-identical), `style.css` (gamma
  block + four fixed-hue `--gamma-*` root vars, dead textbox CSS removed),
  `tests/led_gamma.test.js` (+9), one docs/41 §4.1(d) sentence. Tests
  **1130 / 1122 pass / 8 fail** — this slice's own delta is **+9** (gamma file
  29/29 green); the other +10 came from S4 landing concurrently in other
  files; the 8 failures are byte-for-byte the known pre-existing stale-model
  family. Presets **hold W at 1.0** where the firmware's set W to the RGB
  exponent (docs/41 doctrine — white is derived AFTER the RGB curve), now
  **test-guarded** so a future edit cannot quietly adopt W = 2.2; operator can
  veto for firmware parity. **Operator-side:** visual check handed to him
  (a render session would mean a browser against the sim, forbidden under the
  lockdown) — hard-reload the sim, Controllers → any LED card; real curve
  changes are still device writes behind ⬆ Push gamma / ⬆ Push gamma to all
  and **apply live, no reboot**; the controller's own web console still has no
  Color Curves card (private-repo reflash, his call). **Still open (slot TBD —
  `_66` went to the pixel-map persistence fix):** a verified push mirrors in
  memory only — save the scene after a push until it lands.
  Report: `202607/20260725_65_led_gamma_ui_impl.md`.

- 2026-07-30 — **LED GAMMA UI: FIRMWARE RECON + SIM DESIGN LANDED (`_64`;
  recon + design only — GET-only device probes, no writes, no reboot, no
  browser session against the sim, no code changed, no git ops).** Operator
  order: *"check the gamma UI and curve in the firmware and allow a similar
  setting for the LED controllers from the LED controller config ui in the sim
  … instead of plain textboxes which I don't understand at all."* **Firmware
  presentation** (private repo + device GETs, described not copied): a "Color
  Curves" card = live **SVG plot of all four y = x^γ curves** (quarter grid,
  dashed y=x identity reference, 1/255 video clamp so dim pixels never go
  black) + **four sliders R/G/B/W, 1.00–3.00 step 0.05** with read-only 2-dp
  readouts, a **Link RGB** toggle (W always independent), **preset chips**, a
  debounced gamma-ONLY POST, "applies live — no reboot". **The sim's
  textboxes** are `simulation/src/gui/led_gamma_ui.js:78-110` (four
  `input[type=number]`); everything behind them — validation, mirror, backup →
  gamma-only write → read-back verify → mirror the VERIFIED values — is
  already correct and stays untouched. **Design** = swap the boxes for
  sliders + presets + an inline-SVG curve (offline P0: no library, no CDN),
  with the curve maths as pure exports in `led_gamma.js` so it is unit-tested
  without a DOM, and a dashed **ghost of the last hardware-verified curve**
  when the mirror has drifted. Presets deliberately hold **W at 1.0** where
  the firmware's set W to the RGB exponent (docs/41 §4.1(d) doctrine — the
  controller derives white AFTER the RGB curve), guarded by a test.
  Change surface is **disjoint from the S1 push-flow work** (`_61`):
  `led_gamma.js`, `led_gamma_ui.js`, `style.css`, `tests/led_gamma.test.js`,
  one docs/41 sentence — no `led_discovery_panel.js`, no
  `controller_map_editor.js`, no server files. Gamma needs **no** bridge
  notify (it changes no universe/route/patch). **Filed as a follow-up, after S1:** a
  verified gamma push mutates the mirror in memory only — with autoSave off
  the curve is not in `controllers.yaml` until a manual save, so a reload
  reverts the mirror while the hardware keeps the pushed curve (same shape as
  `_58`'s gap, smaller blast radius). Also confirmed GET-only on the `.60`:
  `gamma` = 1/1/1/1 (curve **off**), `capabilitiesExt.gammaRgbw` true, config
  `version` 3.1.0 — and its **flashed web console still has no gamma card**
  (0 occurrences of "gamma" in every asset it serves), so the sim UI is the
  supported path; putting the card on the device is a private-repo reflash,
  operator-gated. **`_65` implementation queued** (brief in the report §6).
  Report: `202607/20260725_64_led_gamma_ui_design.md`.

- 2026-07-30 — **S4 LANDED: THE NOTIFY IS CHAINED ON THE SAVE, AND ITS
  FAILURES ARE LOUD (`_62`; code + unit tests only — no browser session, no
  scene save, no device HTTP, nothing started or restarted, no git ops).**
  `saveAndNotify` armed a **debounced** save (2 s, and a no-op with autoSave
  off) and notified the bridge from `setTimeout(…, 500)` — so the bridge was
  told to re-read `patches.yaml` **1.5 s before the save even started
  writing**, always, and reported success. **Fix:** `const res = await
  window.exportConfig(); if (res.ok) await notify…` — one awaited chain, and a
  failed save now means **no notify at all** (re-reading the stale file is not
  progress). **Loudness:** new `_surfaceFailure` sends every save/notify
  failure to `console.error` + the red save toast (`window.showSaveToast`, now
  published from `gui_builder`) + a red line in the **sACN-IN monitor activity
  log** (`window.sacnLog`), naming the stale layer and the reconnect self-heal;
  `exportConfig`'s own post-save notify is awaited and loud too — that is the
  path that makes "a save alone is sufficient" true for both 💾 buttons.
  New `notifySacnBridgeLoud()`; the quiet `notifySacnBridge` stays the LED
  push's entry point (it renders its own failure), so loudness never doubles.
  **Caller semantics handled explicitly:** `autoSubscribePatchUniverses` — the
  only in-repo caller — relied on debounce-only behaviour and now calls
  `debounceAutoSave()` directly with **no** forced save and **no** notify
  (forcing would be a surprise disk write against the operator's deliberate
  `autoSave: false`, and would have made read-only agent tools start saving
  scenes; with nothing written a notify is a no-op anyway, and when the
  debounced save does land `exportConfig` notifies after the write).
  **Duplicate notify on a push KEPT by decision** — removing `exportConfig`'s
  internal one breaks "save alone is sufficient", removing the push's own one
  turns S1's third reported step into a guess; `setScene` is idempotent, cost
  is one WS message. WS-reconnect re-send (`sacn_input_source`) untouched — it
  is the self-heal. +10 tests in a new `patch_manager_notify_ordering.test.js`
  (event-ORDER assertions, one-setScene-only proven by waiting out any stray
  timer, both failure surfaces); suite **1111/1103 pass/8 fail → 1121/1113
  pass/8 fail** — the same 8 known stale-model failures, unchanged. **S5 (docs
  + copy review + acceptance prep) is the last slice.**
  `202607/20260725_62_notify_ordering_loudness.md`.

- 2026-07-30 — **S2 LANDED: A PUSH CAN NO LONGER MINT A CROSS-CONTROLLER
  UNIVERSE COLLISION (`_59`; code + unit tests only — no browser session, no
  scene save, no device HTTP, nothing started or restarted, no git ops).**
  `derivePerOutputPlan`'s auto-extender measured "free" against **this
  device's** universes only, which is how the live push put the `.60`'s third
  (enabled, unmapped) output on **U23 — LeftFrontDeck's DMX universe**
  (`_58` §4; inert under unicast routing, armed). **Fix:** the derivation now
  takes a **required** registry-wide claim index (new pure
  `collectClaimedUniverses` — universes owned by OTHER controllers, DMX
  `computeProjection().universeMaps` ∪ `computeLedUniverseClaims()`, with the
  two sources' owner keys resolved correctly: stable `controller.id` for DMX,
  **panel ordinal** for LED, so a card never collides with itself). Auto-extend
  picks universes free across the WHOLE registry; an **explicit** port
  universe on another controller's claim becomes a **blocking refusal** naming
  both sides ("output 3 would take U23 — owned by LeftFrontDeck port 1") — a
  modal on ⬆ Push, a per-controller `failed` in push-all, **no override path**
  and no device write. Threaded through `ledCtx().claimedUniverses` from a
  FRESH projection (never the render cache); `computeSyncState` derives with
  the SAME index so the chip and the push agree (a registry-blind chip would
  invent `U24 → U23` drift no push would ever fix) and reports a colliding
  plan as drift instead of green. No default claim index — an optional one
  would let a future caller silently restore the defect. +11 tests in
  `per_output_push.test.js` (incl. the exact live repro, the ordinal-vs-id
  ownership trap, and the gate proven through `pushAllLedControllers` with
  **zero** device writes); suite **1088/1080 pass/8 fail → 1099/1091 pass/8
  fail** — the same 8 known stale-model failures, unchanged. Device still
  carries U23 on output 3 until the operator disables it or maps + re-pushes
  (`_58` §9.2 — post-S2 that re-push picks a free universe).
  `202607/20260725_59_push_gate_registry_claims.md`.

- 2026-07-30 — **S3 LANDED: THE BRIDGE NO LONGER GOES DEAF ABOVE ITS BOOT
  UNIVERSE LIST (`_60`; code + unit tests only — no browser session, no
  scene save, no device touched, no server started or restarted, no git
  ops).** The `sacn` package's Receiver drops packets for unsubscribed
  universes **with no event** (`receiver.js:22`) and the bridge froze that
  list at boot while `recomputeRoutes` kept minting relay senders from a
  re-read `patches.yaml` — a route that logs "created", holds an open
  sender, shows green in the monitor panel, and carries nothing. Only the
  persisted `sacn_universes: 1..24` override kept this session alive;
  `nextUniverse` is 27. **Fix:** `recomputeRoutes` now diffs and extends the
  receiver's subscription **before** it builds any sender — over the
  effective routes, the engine-owned pairs it deliberately does not relay
  (still browser-bound), and every universe the *active* scenes patch —
  logging each new subscription **once** with provenance
  (`runtime-subscribed U27 (scene 'titanic' patch; relay route → …) — client
  scene 'titanic'`) to console and monitor panel. Never unsubscribes (IGMP
  churn for nothing). The pure diff + an injectable `applyUniverseSubscriptions`
  live in `lib/bridge_routing.cjs`; a failing `addMembership` is isolated
  per-universe, shouted about naming exactly what was lost, and the universe
  stays accepted for **unicast** — boot parity, not a fallback. The
  boot-frozen `MAX_UNIVERSE` drop guard is **retired**: structurally
  unreachable, and post-S3 it would have shadowed the fix by dropping the
  first frame on a newly subscribed universe; replaced by the positive signal
  `✅ First frame on U… — runtime-subscribed after boot`. Tests: +9 in
  `bridge_routing.test.js` (24/24 pass), including the **U27 trap** repro and
  a fake-Receiver throwing-join case; suite 1088/1071 pass/17 fail = the known
  8 stale-model failures + 9 in `per_output_push` / `device_config_mapper`
  from the **S2** slice being edited concurrently (files untouched by S3; no
  test imports `sacn_bridge.js`). ⚠ **Takes effect only on a bridge restart
  — operator-gated** (waiting-item 16): until then the U24 ceiling stands.
  `202607/20260725_60_bridge_runtime_subscription.md`.

- 2026-07-30 — **PUSH-vs-SAVE ROOT-CAUSED + IMPLEMENTATION PLAN LANDED
  (`_58`, Fable per operator's explicit model call; READ-ONLY — zero writes
  anywhere, device probed with GETs only, his live stack untouched).**
  Operator's report ("set output 1 to U21, pushed, device restarted, but LEDs
  only lit after the full Lighting Controls save") is **correct and both steps
  were required by construction**: ⬆ Push writes ONLY the device (+ in-memory
  registry provenance); the strands' hardware feed is the sACN-in bridge
  relay, whose routes are rebuilt exclusively from **patches.yaml on disk**
  (re-read on the `setScene` notify that fires after a save) and whose frames
  exist only because the **engine model file** carries the universes — both
  written solely by `exportConfig()`, and `autoSave: false`, so after a push
  nothing converges until a manual save. Timeline proven from
  `.scene_backups` pre-save snapshots + process start times + the device's
  `lastPush` stamp: every pre-push save that day wrote **zero** `.60` strand
  records because the strand-patch projection covers **bound** cards only
  (`led_patch_projection.js:167`) and the card was unbound (`_56`) — the push
  itself auto-bound it (addendum #3), which is why the *next* save was the
  first that could project the records, create routes U21/U22→`.60`, and
  light the strands "immediately". **Save Configuration (controller pane) is
  already the identical `exportConfig()` full save** as the Lighting Controls
  button — order 2 is literally true today; the plan makes it guaranteed and
  loud instead of incidental. **Overlap check (live device probe):** out1/out2
  = U21/U22, no clash (same-universe plans are hard-refused pre-POST); but
  the push **auto-extended the device's third enabled output (no card port
  row) onto U23 — LeftFrontDeck's DMX universe**: the auto-extender's `used`
  set is plan-local and never consults registry claims. Inert today (unicast
  routes keep U23 at `.11`; output 3 armed-but-dark) — filed as defect +
  operator item. **Latent traps found:** the bridge Receiver's universe list
  is BOOT-FROZEN and the `sacn` package silently drops unsubscribed universes
  (`receiver.js:22`) — this session was saved only by the persisted
  `sacn_universes: 1..24` override, and `nextUniverse` is already 27, so the
  next controller mapped past U24 replays the dark-LEDs day; `saveAndNotify`
  notifies on a 500 ms timer that can race the save; a failed bridge notify
  is a swallowed `console.warn`. **Plan (5 Opus slices, all sim-side, no
  engine code/config/restart):** S1 push completes the loop (awaited
  `exportConfig` + notify + per-step honest dialog; failure = red naming the
  stale layer, "device WAS written"); S2 registry-aware plan gate (auto-extend
  skips claimed universes, explicit collisions block); S3 bridge runtime
  `addUniverse` on route recompute; S4 notify ordering + loudness; S5 chip
  tooltip + docs/41 §4 + **live acceptance = re-run his exact sequence,
  push-only ⇒ LEDs follow** (operator-gated: device reboot + scene save).
  Full trace, evidence index and slice specs:
  `202607/20260725_58_push_save_workflow_plan.md`.

- 2026-07-30 — **THE MOUSE WHEEL NO LONGER EDITS ANY PARAMETER (`_52`
  addendum; operator: "disallow mouse scroll from updating the parameters! I
  randomly accidentally set some values to 0 when I scroll in the menu", then
  "fix the scrolls please"; zero writes to `scenes/**` or `models/**`, no git
  ops, his stack never restarted by me).** A prior agent on this order was
  stopped mid-flight; its edits were found in the tree, **reviewed and kept**
  (nothing reverted) — which also explains his "the gui scroll isn't working
  which is good": his dev server serves from disk, so the fix was already live
  in his page. **Two independent bugs, either one enough on its own.** (1) Our
  own wheel-to-value handlers in `modern_gui/controllers.js`, whose fader guard
  `if (vertical && this._hasScrollBar) return` only yielded to the scroll while
  the children container *happened* to overflow — a short panel, a collapsed
  section or a docked pane sized to fit made every vertical tick over a fader an
  edit, with `preventDefault()` eating the scroll too. **Deleted, not guarded.**
  (2) **Chrome's own stepping of a focused `<input type="number">` — a DEFAULT
  ACTION no `stopPropagation` can reach**, and the half that actually zeroed his
  values given the click-a-field-then-scroll-on habit. Fixed by **one
  capture-phase listener on `document`** (`src/gui/wheel_guard.js`, one install
  site in `main.js`) that stops propagation and **blurs** the focused control —
  never `preventDefault`, and registered `passive: true` so the scroll can
  never be blocked *by construction*. Because it is document-level, coverage is
  a property of the DOM: the DMX patch U/Addr boxes, the controller map editor,
  the LED gamma boxes and the pixel-map Adjust panel's new gap/pitch/glyph
  fields are all `input[type=number]` and all covered; **no iframe and no shadow
  root exists in `simulation/src/`**. Canvas wheel gestures (3D orbit zoom, 2D
  pixel-map zoom) are deliberately untouched and live-proved still working.
  Extended this session: `.slider` added to the guard so the **fader** (a div,
  not a native input) is protected structurally rather than by the mere absence
  of a handler. **The proof is the negative control:** with the guard
  uninstalled, ONE real wheel tick on a focused number input moved `Pixel Size`
  `0.08 → -0.92` — his bug on demand; guarded, the byte-identical tick leaves it
  at `0.08`, and the panel still scrolls (`scrollTop` 427 → 547) with the cursor
  parked on a fader. **The harness had to be reworked to prove anything at
  all:** aimed ticks were landing off-target because Chrome animates wheel
  scrolling and the animation does not start in the tick's frame, so the panel
  moved ~120 px between aim and dispatch — the classic vacuous pass. It now
  asserts only on a **window-capture witness** of where each tick really landed,
  with pointer calibration and a quiet-window settle as hard preconditions.
  Suite 1080/1072/8 — the 8 are the known stale-model/parity family, zero new
  failures by name.

- 2026-07-30 — **MAPPING TRAY + PICKER ARE NOW NAME-SORTED (`_50` addendum;
  operator: "sorted by name … make sure it's fast"; zero writes to `scenes/**`
  or `models/**`, no git ops, his stack never restarted by me).** The
  numeric-aware comparator already existed as a module-private `NATURAL` in
  `pixel_map_layout.js` (from `_44` §2 D1, where a plain compare put
  "Group 10" before "Group 2"); it is now **extracted to
  `simulation/src/core/natural_sort.js` and shared**, so two lists that both
  claim to be "sorted by name" cannot disagree. **Two distinct speed wins, both
  needed:** (1) the comparator is **one cached `Intl.Collator`** built at module
  load — `localeCompare(a, undefined, {numeric:true})` builds a fresh collator
  on EVERY call and dominates the cost of sorting a few hundred names (the
  lanes view gets this for free); (2) **the real trap** — `renderChips()` is
  the filter box's `oninput` handler and was calling
  `unmappedNames()`/`unmappedStrandNames()` **from inside itself**, re-walking
  every scene config and every chain entry per character typed, which a sort
  would have landed straight on. The tray now resolves both source lists
  **once per render** and the filter is a pure order-preserving subset.
  Measured live on `titanic` (78 fixture chips + 6 strand chips): **6
  keystrokes across the whole tray in 2 ms**. Sorted: the unmapped tray's
  fixture chips, its 💡 strand chips (**in their own cluster, after the
  fixtures — clusters kept, not fused**), and the "+ list" picker grid (it IS
  the same tray in pick mode, so one fix covers both). **Deliberately NOT
  sorted: a port's chain chips (physical daisy-chain order and the home of the
  `at:` addresses — sorting would misreport the cabling) and "+ sel" (its
  tooltip promises selection order).** `unmappedNamesByKind()` in the registry
  is untouched, so nothing else inherits an ordering it didn't ask for.
  Validation: new `tests/natural_sort.test.js` (10 tests — the 2-vs-10 trap
  pinned directly, a full 1→11 run, total order + null safety, exactly ONE
  collator constructed, no per-call `localeCompare`, and both consumers proven
  to import the shared function) + 3 new pane tests (both sources sort with
  `compareNatural`; `renderChips()` contains NO call to the source helpers —
  the per-keystroke guard; the chain renderer never uses the comparator); the
  browser tool now reads the rendered chip text in DOM order and asserts
  natural order for both clusters, cluster separation, and a still-sorted
  filtered subset — green on `titanic` + `test_bench`. Screenshot
  `~/tmp/controllers_pane_toggle/titanic_9_tray_sorted.png` vs
  `before_sort/titanic_tray_unsorted_before.png`. Honest gap: after the
  coordinator's scene cleanup **no group in the live scene has both a "… 2"
  and a "… ≥10"**, so the tool reports that and skips its real-pair assertion —
  the trap is pinned in the unit tests instead. Free diagnostic: sorted, the
  two `TE Sign V3 A`/`B` duplicates now sit **adjacent**, so the
  `duplicate_scene_name` defect the parity validator reports is visible at a
  glance. Suite **1002 / 994 pass / 8 fail** — back to the stated baseline
  count of 8, shape changed exactly as predicted by the coordinator's on-disk
  scene fix (ghost `Left Back Wall 1-5` deleted, `Left Back Wall Generator*`
  renamed; operator restarted his stack 09:23). All 8 are the
  stale-titanic-model family; none of their files import anything touched, and
  `pixel_map_layout_expansion.test.js` (the comparator's original guard) still
  passes after the extraction. **NOT taken** (would have slowed the sort he was
  waiting on, and neither is a one-liner): the duplicate controller-name guard
  (needs a registry-level uniqueness rule + tests, and touching
  `addController` while he is adding controllers live is the wrong moment) and
  the loud `+port` — both remain small, well-understood follow-ups.
- 2026-07-30 — **VINTAGE FIXTURE SIZING: A FIXTURE'S PIXELS CAN NO LONGER FUSE
  INTO A BLOB (`_53`, `20260725_53_vintage_fixture_sizing.md`; Opus implementer,
  3D render path only, zero writes to `scenes/**` / `models/**` / fixture model
  YAMLs, no git ops, no output/sACN control touched).** Operator order, with a
  close-up screenshot: a vertical column of large fused blobs where the Vintage
  LED's heads should be, circled next to a fixture showing a neat run of tiny
  yellow-green dots — *"please resize the vintage fixtures to match the sizing
  that I show in this screenshot."*
  **Root cause — and it is NOT `_49`.** Verified against `HEAD`: the DMX-bus
  bulb rule (`p.bulbSize * repScale * pixelScale`) and the DMX-bus halo rule are
  byte-identical before and after the halo-parity work, which only ever touched
  the LED-bus branch; `VintageLed` is `bus: dmx` and was never reclassified.
  The real defect is pre-existing and general: a model fixture's core is its
  PHYSICAL pixel size times the global **"Global Pixel Size"** slider (0.1–5), a
  multiplier that never consults how far apart the fixture's pixels actually
  are, while an LED strand's radius is the absolute `params.ledPixelSize` and
  the slider **cannot reach it at all**. The vintage light is 18 mm heads on a
  75 mm pitch, so it fuses at slider ≥ **1.88** — and `scenes/common.yaml` at
  `HEAD` ships **5**, i.e. a core **2.67× wider than the gap between heads**,
  drawn beside a strand still sitting at 0.28 × its own spacing. That contrast
  IS the screenshot. Same shape on ShehdsBar (fuses ≥ 1.38), TeLedGrid (≥ 1.25),
  TE Sign (≥ 4.17); the single-head par is exempt.
  **Fix:** `led_halo.js` (the module `_49` established as the one home for LED
  sizing) gains `MAX_BULB_PITCH_FRACTION = 0.3` + `clampPixelRadiusToPitch()` +
  `minPixelPitch()`; `dmx_fixture_runtime.js` measures its own nearest-neighbour
  pixel spacing ONCE at build and bounds the core by it, with the DMX-bus rim
  bounded by the same ceiling × the (now named) `HALO_RIM_FACTOR`.
  **0.3 is not a taste number** — it is the ratio the reference LED strands
  already render at (`0.080 / 0.2835 = 0.28`), so 40 % of the pitch stays dark
  gap. **The sliders still work**: below the ceiling every value passes through
  untouched and `updateScales()` is unchanged; LED-bus halos are still exactly
  `ledHaloSize × globalHaloScale` per pixel, so `_49`'s rule survives intact (a
  backlit sign is *meant* to merge — only the opaque core is bounded);
  `fixture_representative` mode is exempt because one stand-in instance cannot
  fuse with itself. Nothing is hardcoded — the ceiling is computed from the
  fixture's own model geometry.
  **Measured before/after** (read off the real `InstancedMesh` matrices, every
  shipped YAML through the real registry, at the committed 5 / 4.7): vintage
  bulb **0.1000 (1.33× pitch, fused) → 0.0225 (0.30× pitch, distinct)**, halo
  **0.1692 → 0.0405**; at the working tree's 1.1 / 0.6 the vintage light, the TE
  Sign and the par are pixel-identical and only the two densest fixtures tighten
  to the reference ratio.
  **Tests:** new `tests/fixture_pixel_pitch_sizing.test.js`, 7 tests sweeping
  every shipped model — no fixture fuses at ANY slider position, a vintage
  regression pin measured against a real `LedStrand` built from titanic's own
  `Left_Front_Left` endpoints, sliders-still-linear, throws-on-garbage, and a
  guard that LED-bus halos never leave `ledHaloRadius()`. **Sim suite
  1002/994/8 — the SAME 8 named stale-model failures, zero new** (995 → 1002 is
  this report's 7).
  **CAPTURED once his sim came back up** (one short session, new harness
  `agent_tools/vintage_sizing_capture.cjs`). It cannot revert the source to make
  a "before" without editing his working tree mid-session, so it writes the
  **pre-fix instance matrices in the page** (formula verified against `HEAD`)
  and `updateScales()` restores the shipped sizing — nothing touches disk.
  Guards all clean: **0 `[sACN Out] Enabling` lines, 0 requests to `:6970`**,
  `__readonlyMode` held as an accessor, the `:6972` bridge socket refused at the
  `WebSocket` constructor, his scales snapshotted and **restored to 1.1/0.6**,
  trace overlay put back, browser closed, no leftover Chrome. Live scene
  surveyed 16 `VintageLed` (pitch 0.0750) + 8 strands, `_patchesActive: true`.
  ⚠ **VERDICT — the visual defect only appears at HIGH slider values.** At his
  current 1.1/0.6 the vintage column already reads as six distinct heads and the
  before/after frames are indistinguishable (bulb 0.0220 / halo 0.0216 in both),
  exactly as predicted; at 5/4.7 the bug reproduces fully — cores touching in a
  chain inside one huge merged amber blob — and the fix leaves six clearly
  separate heads at the same camera. So the column he screenshotted was rendered
  at a high "Global Pixel Size"/"Global Halo Size". `tight_*` / `pair_*` /
  `zoom_*` PNGs + the numeric table in `~/tmp/vintage_fixture_sizing/`.
  ⚠ **Worth his ruling:** "Global Pixel Size" still does not reach LED strands
  at all — that asymmetry is *why* the slider ended up at 5. Either fold the
  strand bulb onto the same multiplier or relabel the control; left alone here
  because the strands are the reference he says is already correct.
- 2026-07-29 — **LED FIXTURES MENU: MAPPING UX LANDED (`_52`,
  `20260725_52_led_fixtures_menu_mapping_ux.md`; Opus implementer, zero writes to
  `scenes/**` or `models/**`, no git ops, no output/sACN control touched, his
  stack never restarted).** Five operator asks on the LED Fixtures menu + LED
  controllers, all handled while he was live-mapping hardware. **(1) "Let me
  rename the groups we have now" — the control was never missing; it was 51 px
  wide and needed 67.** In his docked pane the group toolbar rendered
  `— Re...  [UkingPar (10ch)]  × Del...` — both text buttons clipped to noise by
  the `min-width:0` that lets a flex child shrink below its content, so the
  ellipsis "safety net" WAS the everyday rendering. Both group toolbars (par +
  LED strand) now **wrap instead of clip** (`flex-wrap` + `min-width:max-content`
  on the text buttons) and both buttons gained tooltips; measured 51 px clipped
  → **262 px unclipped**. A tidier two-row variant was BUILT and REVERTED with
  the measurement that killed it: `min-width:0` on the fixture-type `<select>`
  collapsed it to nothing (type name gone, only the green `+` left) — three
  legible rows beat two with an unreadable control, and the reasoning is now a
  comment so nobody optimises it back. **(2) The duplicate-name guard had a hole
  big enough to fuse two groups.** Group names are ONE scene-wide namespace — the
  view-registry `groupBits` → `views.yaml`, the 2D Pixel Map `{group: …}`
  selectors, and every exported model pixel are all keyed by name — but each
  control policed only its own list (par checked par, strand checked strand,
  neither checked generator `groupName`), and the **DMX `➕ Add Group` had NO
  guard at all** (empty answer ⇒ a group literally named `""`; a name matching a
  trace ⇒ config.js re-stamps the new fixture `traceGenerated` at the next load).
  New pure module `src/dmx/group_rename_guard.js` is now the single definition of
  "taken", wired into **all five** name-entry points; it THROWS on a malformed
  scene bag rather than reporting an empty namespace. **(3) The par-group rename
  had no `pushUndo()` at all** — a mistyped rename was unrecoverable; both renames
  now push undo and both refuse BEFORE the push. **(4) A group rename now reports
  itself**, and deliberately NOT in `_47`'s CHECK+INVALIDATE language: a group
  rename changes no fixture NAME, so nothing is unmapped and saying otherwise
  would be the same species of lie as the old "channels freed" (tests assert the
  report never says `INVALIDATED`/`channels freed`, and that neither handler
  writes `dmxAddress`/`dmxUniverse`/`.name`). One line for CARRIED display state
  (master, view bit, pixel-map selectors), one for UNTOUCHED mapping, and one the
  system had **no way to surface before — the exported model + viewmasks sidecar
  are now STALE**, because the sim's stale-model banner only watches PIXEL COUNT,
  which a rename does not change. Plus a toast, verified rendered (opacity 1,
  on-screen), not merely present in the DOM. **(5) LED `+port` could not give back
  a deleted output.** On an LED controller a port IS a device output
  (`derivePerOutputPlan` keys by `port.port - 1`), but `addPort` minted
  `max + 1`: delete output 2 of a 4-output board, press `+port`, get port **5** —
  addressing a `strands[4]` that does not exist, while output 2 stays unreachable
  forever, and the dead port is dropped from the plan **silently**. LED adds now
  fill the **lowest free slot in 1…16** (`LED_MAX_OUTPUTS`, the device's own
  `/api/config` 1–16 `strands` contract, docs/41 §4.2), throw loudly past it, and
  insert in port order; **DMX numbering deliberately unchanged** (its port numbers
  are chain labels, not hardware indices). Proven live `[1,2,3,4] → rm P2 →
  [1,3,4] → +port → 2 → [1,2,3,4]`. **The two follow-up asks were already
  satisfied**: `renderController()` is SHARED by DMX and LED cards, so the LED
  card already had the identical editable name box (measured 308 px, 2-row header)
  and the `+port` button — the Controllers-pane agent's rework landed on both
  types at once. Research finding: **`controller.name` keys nothing** (identity is
  `id` + `ip`; sACN/bridge route on `{universe, ip}`; patches carry
  `controllerIp`/`controllerId`) so rename-hygiene correctly does not apply — what
  IS missing is a duplicate-name guard, handed to the Controllers-pane agent along
  with "make `+port` loud", since `controller_map_editor.js` is their territory
  and the whole behaviour change lives in the registry (a wiring test asserts the
  button still just calls `addPort`, so the two edits cannot collide). **⚠ TE SIGN
  FINDING, his call, nothing touched (item 3 = verify-only):** the sign DOES
  already get its own born-locked group and a second press offers a separate one
  via a themed confirm — so item 3 needs no work — **but `buildTeSign` always
  emits the same fixture names, so `TE Sign` and `TE Sign 2` both contain
  `TE Sign V3 A` / `TE Sign V3 B`.** The scene now has DUPLICATE FIXTURE NAMES:
  the parity validator already errors `duplicate_scene_name … fixture names are
  the join key`, `patches.yaml` collapses them to one record, and the Unmapped
  tray shows **four indistinguishable chips** while he maps (visible in the
  screenshot). Options in `_52` §3: rename the second sign's two fixtures (cheap
  now, before they are mapped), delete them if it was a double-press, or fix the
  source so the generator uniquifies fixture NAMES and not just the group.
  **Item 1 (generator-style LED config: density etc.) is DESIGN ONLY as
  instructed — no code written**: `_52` §4 specs a persisted `params.ledGenerators`
  recipe mirroring `params.traces`, reusing the path/shape/point-handle math,
  the card grammar, and the sticky `"<group> N"` + rename-aware-sweep contract
  verbatim — and **explicitly REFUSING to reuse `chainSplits`**, because LED wire
  order is already the port chain the operator builds in the Controllers panel and
  a second wiring declaration would be two sources of truth for one physical fact.
  The genuinely new idea is `layout: density` making PIXEL PITCH authoritative and
  DERIVING count from path length (the inverse of the trace model, and what real
  strip hardware wants), with the mode explicit and mutually exclusive, and a loud
  warning when a density edit changes total pixel count (that IS what stales the
  engine model). **~3.5–4 days full, ~2 days for a numeric-entry card without 3D
  handles; 5 open questions for Sina** (which model(s) — the catalog has only the
  fixed-geometry sign today; density unit px/m vs mm; does the sign become a card
  too; confirm the chainSplits ruling; auto-regenerate on a density change or
  require an explicit press). **Harness `agent_tools/led_fixtures_menu_verify.cjs`
  10/10 green** (5 runs; run 1 caught BOTH defects code review missed — the
  clipped button, and the `<select>` collapse). **Sim suite 980/972/8 — the same 8
  stale-model failures BY NAME, zero new** (baseline moved 903→924→980 as other
  agents landed work in parallel; judge by WHICH fail). **Zero scene/model
  writes**: triple-guarded, **0 save requests attempted** on all 5 runs, params +
  controller registry restored deep-equal to pristine, every probe object a
  throwaway `ZZ …` name, his own groups read-only.
- 2026-07-29 — **MAPPING-PANE ERGONOMICS LANDED, live-session safe (`_50`,
  `20260725_50_controllers_pane_toggle.md`; Opus implementer, zero writes to
  `scenes/**` or `models/**`, no git ops, operator's stack never restarted).**
  Three operator asks on the docked Controller Mapping pane, all fixed while he
  was mapping real hardware on `titanic`. **(1) Controllers hide/show.** The
  controllers list owns 3/4 of a docked pane (`.cm-user-sized .cm-main
  flex: 3`), burying the unmapped tray — 91 fixtures + 8 strands on `titanic`
  crammed into a sliver. A new `Controllers (n)` section head *outside* the
  scroll region carries a `▾/▸` chevron; collapsing hides only `.cm-main` and
  the tray takes the whole pane. **Display-only and cheap: one class flip, no
  re-render, no projection, no registry touch** — pick mode, a half-typed
  address and the tray filter all ride through it (proven by DOM node-identity
  probes in the browser). Persists per-machine via
  `bm26.map.controllersCollapsed`, the same idiom as the camera-focus pref.
  **(2) Controller name box was truncating to ~5 chars** (`LeftF…`): root cause
  is `.cm-name { flex: 1 }` = a **zero flex-basis**, so the 108 px docked IP
  box and four text buttons took the row first and `.cm-input`'s `min-width: 0`
  let the name collapse silently. The card header is now **two rows** —
  identity (name + IP) over actions (`DMX`/`sACN`/`+port` … `🗑`, delete pushed
  right) — with `flex: 1 1 auto; min-width: 120px`. Measured at the 320 px
  `MIN_MAP` minimum: name box **185 px**, `LeftFrontWall` renders untruncated.
  **(3) The `⚠ UNPATCHED — SIM-ONLY MODE` pill was sitting on the "+ list"
  picker chip grid** (fixed `bottom:140px/left:14px` was authored for a
  full-window 3D view; the docked pane now owns that corner). `split_layout.js`
  publishes `--sim-pane-left` + `sim-map-docked`/`sim-map-full` body classes on
  every layout pass, and CSS parks the pill over the 3D view instead —
  **relocated, never suppressed**, and it tracks divider drags. Measured
  overlap with the picker open: pane ∩ pill and chips ∩ pill both **0 px²**
  (the pre-fix overlap is reproduced in the same run for the before/after).
  Validation: new browser tool `agent_tools/controllers_pane_toggle_verify.cjs`
  (agent_render can't open the pane), green on `test_bench` + `studiodj` +
  `titanic`; 21 new unit tests; sim suite **960/951/9** where all 9 are the
  known stale-titanic-model family and none of their files import anything
  touched — the 9th is the operator's own 16:54 save (`LeftLeftFront` LED
  controller, strands `Left_Front_Left`/`Left_Back_Left` in the model but not
  yet in `patches.yaml`). **Live-session safety:** `?readonly=1` is unusable
  for this pane (`main.js` skips `setupControllerMapEditor` in observer mode),
  so the probe **blocks the sACN OUT bridge socket (ws :6972) before first
  script** and asserts `connected === false` / `framesSent === 0` before
  touching anything; `find scenes -newermt <probe start>` is empty.
  **Task 2 (read-only, no code): "Clear All Patches" vs controllers.**
  `clearAllPatches` only does `port.chain.length = 0` — keeps controllers,
  ports, universes, LED config and device/gamma provenance. **Test controllers
  are NOT distinguishable by any field**: `testAutoPatch` calls the same
  `addController` as the modal, its `TEST DMX`/`TEST LEDs` names and two
  hard-coded private test IPs are module-private constants unread anywhere
  else, those IPs are not sentinels (the relay will happily route to them),
  and it *reuses* a real controller when one exists. Grounding fact:
  `TEST DMX`/`TEST LEDs` survive only in today's `.scene_backups/titanic/…`
  snapshot — the operator ran Test Auto-Patch and cleaned them **by hand**,
  which is the ask. Deleting a controller is cheap to execute but expensive in
  truth: it destroys every `at:` address (the only home of sticky-by-name),
  burns universes permanently (`nextUniverse` never rewinds), discards the LED
  `lastGammaPush` provenance, renumbers the projected `controllerId` of every
  later controller, and offers only a ~10 s undo toast (an EMPTY controller
  deletes with no confirm at all). Engine coupling is loose —
  `marsin_engine` reads its own `config.yaml`, not `controllers.yaml` — so a
  delete desynchronizes rather than breaks. **Recommendation: keep Clear All
  Patches mapping-only; add an opt-in checkbox inside its existing confirm
  ("also remove controllers created by Test Auto-Patch (N)", default on when
  N > 0); mark them at creation with `origin: 'test'`, which needs one line in
  `createControllerRegistry`'s whitelist re-constructor or it evaporates on
  reload; never delete an unmarked controller from that flow. ≈3 h.**
- 2026-07-29 — **R10 SLICE 2 LANDED: RENAME HYGIENE = CHECK + INVALIDATE,
  LOUDLY (`_47`, `20260725_47_rename_hygiene.md`; Opus implementer, plan `_44`
  steps 8-13, zero writes to `scenes/**` or `models/**`, no git ops, his stack
  never restarted).** The operator's ruling (2026-07-29) is now the shipped
  default: **a rename CHECKS the mapping and INVALIDATES it, fixture by
  fixture, out loud.** Before, a mapped group rename unmapped everything *by
  accident* — the regenerate's casualty set is all N when the old and new name
  sets are disjoint — and reported it as `"N deleted fixture(s) unmapped —
  channels freed"`, which is untrue: nothing was deleted, and the operator had
  no way to know which addresses he had just lost. Now the rename **enumerates
  the mapping first** (new pure registry primitives `describeFixtureMappings` /
  `invalidateFixtureMappings`, the latter THROWING if an enumerated entry
  cannot be removed — half an invalidation is the silent-partial state the
  codex forbids), prints **one line per fixture** naming controller, IP, port,
  universe and address, prunes every old-name `__globalPatchTree` key with its
  own line (values NEVER copied to the new names — that is the silent
  carry-over the ruling bans), and shows an accurate 9-second summary. The
  renamed fixtures come out honestly **UNMAPPED** — `controllerIp:''`,
  `dmxUniverse:0`, `dmxAddress:0`, `controllerId:0`, i.e. the parity
  validator's `unmapped_fixture`, **never `drift`**. Display state still
  follows the name (group master override, group view bit, per-fixture
  `viewMask`), each with a line saying so. **Step 8**: the `chainSplits` gate
  now runs BEFORE any mutation, so an invalid-splits rename reverts cleanly
  instead of stranding the old-named group with no master, no lock and no view
  bit (`MASK_*` drift). **Step 11**: all four individual Name controls route
  through one shared path — duplicate-name guard (duplicates collapse to a
  single patches.yaml record and hard-fail the next scene load), then the same
  check-and-invalidate; `propagateToSelected` now **throws** on `'name'`
  instead of stamping one name onto every selected fixture; the strand path was
  **verified live**, closing `_44` §6's "traced, not executed". **Step 12**:
  par-group rename finally invalidates the batch cache (`par_group_rename` —
  view isolation reads the cached `entry.group`), and BOTH par and LED group
  renames re-point 2D Pixel Map `{group: …}` selectors so a rename can never
  again silently empty a panel (globs are operator intent and are left alone;
  the zero-match canvas error already existed, so the plan's "silent empty
  pane" premise was stale — a de-duplicated `console.warn` was added). **Two
  defects the LIVE harness caught that code review had not:** pruned patch-tree
  keys were being *resurrected* because the projection re-mints a key for every
  live config and the old-named fixtures were still present at that instant
  (fixed by deferring the projection to the regenerate, which runs after the
  sweep); and the summary toast **never rendered at all** — it sat 4 px under
  the multi-client contention banner AND its fade-in was armed in the same
  synchronous task as its insertion, so with the regenerate blocking the main
  thread the transition was left in flight (measured: inline opacity `1`,
  COMPUTED opacity `0` after 2 s of rAF polling, invisible in the screenshot).
  Both fixed and pinned; the toast is now proven by a **cropped screenshot of
  its own rect**, not a DOM read. That toast fix helps every message the
  auto-patch toast carries, not just renames. 50 new tests (35 behaviour, incl.
  the LOG CONTRACT — the ruling is about what the operator is *told*, so
  "it happened to end up unmapped" does not pass; 15 wiring-regression tests
  pinning gate ORDER, the no-reproject fix, and that gui_builder never
  references the migrate primitive); `trace_rename_verify.cjs` gained a MAPPED
  case (synthetic in-memory registry, never saved), a REFUSAL case and a toast
  visibility assertion — **8/8 checks green**. **Sim suite 903/895/8 — the SAME
  8 pre-existing stale-model failures, zero new**; parity CLI byte-unchanged
  (titanic 192/0/9, test_bench 4/0/1); all `scenes/**` + `models/**` mtimes
  identical across 8 browser runs, **0 save requests attempted**. ⚠ **TWO
  ITEMS FOR SINA.** (1) **Ratify step 11's refusal**: individually renaming a
  *generated* fixture is now a LOUD REFUSAL pointing at the group-rename and
  ⛓ Chain Order paths, on the grounds that `"<group> N"` is the contract every
  sticky store keys on and the next Regenerate overwrites a hand-typed name
  anyway — accepting an edit and quietly undoing it later would be the silent
  fallback the codex forbids. Kept **trivially revertible**: one function plus
  one `if` branch. (2) **Step 11b was NOT built** — the opt-in "⇄ Migrate
  addresses to new name" affordance awaits his yes/no (`_44` §5 Q4);
  `renameFixtureInChains` stays intact-but-unwired with a test guaranteeing
  migration cannot become the default by accident. Step 17 untouched (gated);
  the 12 orphaned generated fixtures neither deleted nor renamed (his call)
- 2026-07-29 — **LED HALO PARITY: THE TE SIGN NOW GLOWS LIKE EVERY OTHER LED
  (`_49`, `20260725_49_led_halo_parity.md`; Opus implementer, 3D render path
  only, zero writes to `scenes/**`, models, or `src/gui/pixel_map/*`).**
  Operator order: *"make sure the TE sign has halos too like the other LEDs —
  all LED fixtures need to abide by the halo settings we have."*
  **Root cause:** the halo was a property of the render CLASS, not of being an
  LED fixture. `dmx_fixture_runtime.js` had an explicit
  `if (isLed) { sprites } else { haloInst }` — LED-bus fixtures (TE Sign V3
  A/B, TE LED Grid) got their halo REPLACED by per-pixel diffusion Sprites
  that were gated on the per-fixture `diffusion` toggle and sized from the
  model YAML's **physical** pixel size (12 mm). Measured against an LED
  strand's `params.ledHaloSize 0.14 × params.globalHaloScale 3.6 = 0.504`
  world units, the sign's effective halo was **~0.075 — about 7× too small**,
  and **zero** with diffusion off. Nothing pushed the "Halo Size"/"Pixel Size"
  sliders to LED-bus fixtures at all (`applyLedSizeToAll` walked
  `ledStrandFixtures` only; the sign lives in `parFixtures`).
  **Fix — general, not TE-Sign-shaped:** new `src/fixtures/led_halo.js` is the
  ONE halo recipe (material + `ledHaloRadius()` + `isLedBusFixture()`, keyed on
  `bus: led`, never a type name) and BOTH LED render paths use it. Every
  fixture — DMX and LED-bus — now builds the instanced additive rim; the
  diffusion sprites became an extra layer on top instead of a replacement; an
  LED-bus fixture sizes its halo from the LED halo settings while a DMX par
  keeps its physical rule; the GUI sliders now reach LED-bus fixtures live.
  **A second instance of the same gap was found and closed:** the legacy
  `ModelFixture` class renders per-pixel dot `Mesh`es with **no halo at all**,
  and `fixtures.js` routed anything with a loaded model there — reachable
  today, because the "🔌 DMX Light Fixtures" type dropdown lists **every**
  registered model including the TE Sign. LED-bus models now fall through to
  `DmxFixtureRuntime`.
  **Perf:** zero new objects per pixel — the sign gained exactly ONE
  `InstancedMesh` per half (one draw regardless of pixel count), and a test
  fails if any fixture ever draws per-pixel halos. Fix #2 strictly reduces
  object count.
  **Tests:** new `tests/led_halo_parity.test.js`, 9 tests, sweeps **every**
  model YAML in `dmx/fixtures/` from the real registry (so a future LED product
  is covered on arrival): one halo batch per fixture, shared material recipe,
  LED-bus halo radius **equals** an LED strand's per pixel, live tracking of
  `ledHaloSize × globalHaloScale`, default fallback, and halo-independent-of-
  diffusion (the exact regression). **Sim suite 900/892/8 — the SAME 8
  pre-existing stale-titanic-model failures, zero new.** Before/after captures
  at an identical camera in `~/tmp/te_sign_halo/` (+ `.agent_renders/`): bare
  dots → a continuous backlit glow matching the hull strands in the same frame.
  Tooling side-win: `agent_render.cjs --camera x,y,z --target x,y,z --label
  <slug>` (via new `window.animateCameraToPose`) frames an arbitrary detail so
  agents never write a throwaway preset into the operator-owned
  `scenes/*/cameras.yaml`; documented in `.agent/skills/see_the_world.md`.
  **Still owed by the operator (unchanged):** re-export `models/titanic.js` +
  restart the engine to clear the 8 stale-model failures.

- 2026-07-29 — **R10 SLICE 3 LANDED: NAME/INDEX PARITY SURFACES + HIS CHIMNEY
  RING RESTORED (`_46`, `20260725_46_name_index_parity_surfaces.md`; Opus
  implementer, ran in parallel with slice 1, zero writes to scenes/models,
  live checks as a triple-save-guarded browser client of :6969).** Steps 14
  and 16 of `_44` §4 slice 3, the coordinator's decision on step 12, and an
  operator ruling that cancelled step 15/18 mid-session.
  **Step 14 — the one genuine ordering bug is dead.** The 2D Pixel Map `lanes`
  seeding (`pixel_map_layout.js`) compared fixture names with a plain
  `localeCompare`, so a group of ten or more stacked its rows
  **1, 10, 11, 12, 2, 3, …** — the view whose entire purpose is to read
  fixtures in order was the one view disagreeing with the chain order. It now
  compares NATURALLY (`{ numeric: true }`), on the group key and the fixture
  key alike, so groups sort naturally too and no group is interleaved with
  another. Proven in unit tests AND live through the real panel:
  rows render `1..12`. Honest caveat: the live titanic scene's largest group
  is **8** lights, so the bug is not reproducible on it today — both the test
  and the probe use a synthetic 12-light group. Any generator he grows past
  nine hits it.
  **Step 16 — the renumber confirm no longer undersells itself.** It named DMX
  addresses as the sticky-by-name thing; `sectionId`/`fixtureId` and the
  operator's hand-placed 2D pixel-map anchors are keyed on the name too and
  move to a different physical light with the number. The dialog now lists all
  three explicitly.
  **Step 12 (coordinator's decision) — his right chimney ring is BACK.**
  `pixel_map_view_defaults.js` still hardcoded `'Right Top Chimney Generator'`;
  measured live, that name resolves to **0 clusters** in the scene, so his
  rename to 'Right SmokeStacks' had silently emptied that half of the default
  Top-Down view — a selector matching nothing just renders nothing. Re-pointed
  at the current names; the default view now resolves **8 clusters for each
  ring**, screenshotted. **Deriving the defaults from the live group list —
  the structural fix that would delete this failure mode — is deferred for
  Sina to opt into** (§5.2); until then a new test file fails BY NAME if either
  group leaves the scene, so the next rename is a red test rather than an
  empty panel he has to notice. Controllers chain chips also gained a tooltip
  saying out loud that chain order is CABLE documentation, never re-derived —
  otherwise chips reading "… 10, 2, 3" look like the bug step 14 just fixed.
  **Steps 15/18 — names in the 3D viewport: BUILT, MEASURED, REVERTED.** The
  full `"<group> n"` guide label was implemented and went green, and the
  harness measured it at **7.58× wider than tall per label** — overlapping
  noise on a par ring. The operator ruled mid-session: *"I don't like the names
  on the generator guides too messy, just the index is enough."* Fully
  reverted; the guides ship **index-only**. Two things kept on their own
  merits: a cross-module test pinning the guide's number to the `n` in the
  `"<group> n"` name `emitInChainOrder` stamps (both derive from
  `expandChainOrder`, through different functions in different modules), and a
  harness check that goes red if name plates ever come back. A hover tooltip /
  selected-fixture HUD line remains available as a future ON-DEMAND option if
  he ever wants a name in the viewport without the clutter.
  **24 new tests; sim suite 805/797/8 → 829/821/8 — the SAME 8 failures before
  and after, zero new.** ⚠ Same baseline correction slice 1 found: the plan's
  `805/803/2` predates the operator's 13:46 saves, and the 8 are the stale
  `models/titanic.js` ('Left Front Wall Generator …' vs the scene's
  'Left Front Wall …', sim banner `981 → 987`) plus the 2 owed test_bench
  drifts — **they clear when he re-exports the model and restarts the engine.**
  Parity CLI verdicts byte-unchanged (titanic 192/0/9, test_bench 4/0/1); all
  77 `scenes/**` mtimes identical across every browser run, **0** save-server
  requests even attempted; new harness
  `agent_tools/name_index_parity_verify.cjs` 5/5 and the extended
  `chain_order_viz_verify.cjs` 11/11, adapter recorded (`integrated: false`).

- 2026-07-29 — **R10 SLICE 1 LANDED: SELECT FREEZE KILLED + COLD MOVE IN
  (`_45`, `20260725_45_select_freeze_cold_move_fix.md`; Opus implementer,
  zero writes to scenes/models, measured live on :6969 as a triple-save-guarded
  browser client, RTX 4090 `integrated: false`).** Steps 1-7 of `_44` §4 slice 1,
  verbatim. **Step 1** — `main.js` now wires `onTransformChange` to
  **`objectChange`**, never `change`: the vendored control dispatches `change`
  from the setter of EVERY tracked property (TransformControls.js:124), so
  `attach()` and gizmo hover were running a full mutation handler. Audit found
  nothing riding `change` for rendering (`animate()` is an unconditional rAF
  loop), so no render-only listener was added. A real 3D select-click:
  **2,719 ms → 0/67/67/77/100/133 ms** max rAF gap across six fresh-browser
  runs, **0** `invalidateMarsinBatchCache`, **0** regenerates (was 1 + 1).
  **Steps 2-5** — COLD MOVE: the per-tick `generateGroupFromTrace` is replaced
  by a dirty mark in a new PURE, unit-testable module
  `simulation/src/dmx/trace_regen_scheduler.js`, flushed EXACTLY ONCE by
  `flushPendingEditorRegens()` on the existing `dragging-changed` release seam
  (inside the same undo step — `pushUndo` still fires at drag start). Every
  lightweight per-tick update stays: trace fields, handles, polyline + preview
  dots, aim line, chain-viz reparent, and for strands `writeTransformToConfig`
  + `rebuildVisuals`. Outside a drag (undo, programmatic) the handler
  regenerates immediately, as before. Per-tick handler JS **24.5 → 0.1 ms**
  (circle hitbox), **23.7 → 0.4 ms** (line start-handle), 0.2-0.5 ms (strand);
  the ~2.4-2.9 s frame stall PER TICK is gone (**0-100 ms max gap for an entire
  10-tick drag, 0 rebuilds**); paced drag **0.4 FPS → 52-59 FPS**, which is
  **1.00-1.03× the idle FPS measured in the same interleaved sample**. Release
  fires exactly one flush and one `fixtures rebuilt` (or one `strand_transform`).
  **Step 6** — the `_2` LED move-trail bug can never return silently: release
  ALWAYS invalidates, and the mandatory trail regression asserts the cached
  batch render list equals a FRESH `generatePixelMap()` — 987 cached == 987
  fresh pixels, **0 stale coordinates** — after a generator drag AND an LED
  strand handle drag. **Step 7** — new harness
  `simulation/agent_tools/generator_ux_verify.cjs` (21 checks, all green,
  re-runnable) plus 17 unit tests: 10 scheduler contract tests (40 ticks ⇒ ONE
  flush; take clears; no marks ⇒ no flush; ascending dedup so chain numbering
  never depends on drag order; bad index THROWS — a dropped mark would strand
  the operator's fixtures) and 7 wiring-regression tests that fail loudly if
  anyone re-wires `change` or puts a regenerate back into a drag tick, because
  both bugs were single lines. **Operator-visible semantic, exactly as ratified
  (`_44` §5.1):** mid-drag the generator's ring/handles/dots/chain-viz track the
  cursor while the generated fixtures and the global dot overlay FREEZE, then
  catch up in ONE regenerate on release — measured on a 6-unit drag of "Right
  SmokeStacks": trace x 23.247 → **29.247** while the 8 fixtures stayed at
  23.247, both at 29.247 after release; screenshotted UI-free for him
  (`~/tmp/generator_ux/02_middrag…`, `03_after_release…`). Two side wins: a
  select-click no longer marks the scene dirty (attach used to reach
  `debounceAutoSave`), and autosave now defers with the regenerate, so a 2 s
  pause mid-drag with auto-save on can no longer persist a scene whose
  generator moved but whose fixtures did not. **Sim suite 805/797/8 →
  829/821/8: the SAME 8 failures before and after, zero new** (the plan's
  `805/803/2` baseline predates his 13:46 saves — `models/titanic.js` is stale
  again, `Left Front Wall Generator …` vs the scene's `Left Front Wall …`, and
  the sim shows `ENGINE MODEL STALE 981 → 987`; a re-export + engine restart
  clears them). Parity CLI verdicts unchanged — this slice reads scenes/models
  and writes neither: 0 save-server requests attempted, `scenes/**` mtimes are
  6 minutes OLDER than my first source edit and did not move across seven
  browser runs, pristine params restored every run, probe browsers closed, his
  stack never restarted. `interaction.js` was in scope but needed no change;
  slice-3 files untouched. Flagged for him: titanic carries co-located fixtures
  (`"Left Back Wall 1" & "Left Back Wall Generator 5"` + 3 more within 5 cm)
  that raise the overlap toast on every `rebuildParLights`, and par-fixture
  (non-generator) drags still invalidate the batch cache per tick (~20-25 ms) —
  the obvious next cold-move candidate, out of slice-1 scope.
- 2026-07-29 — **R10 GENERATOR EDITOR UX DIAGNOSED + PLANNED (`_44`,
  `20260725_44_generator_ux_fixes_plan.md`; Fable planner, read-only on
  scenes/models, profiled live on :6969 as a triple-save-guarded browser
  client, RTX 4090 `integrated: false`).** The operator's four complaints
  root-caused with numbers: **select freeze** = `main.js:240` listens to
  TransformControls' `change` — which the vendored control dispatches from
  EVERY property setter, including `attach()` and gizmo hover
  (TransformControls.js:117-124) — so clicking a generator runs a full
  `generateGroupFromTrace` → `rebuildParLights` (all 82 fixtures destroyed +
  recreated) → the TN backend recompiles programs and checks them
  synchronously: **one 2,719 ms rAF stall per 3D select-click**, CPU profile
  dominated by `getProgramParameter`; the GUI-card select path (no attach)
  costs 83-100 ms and proves the attribution. **Drag lag** = the SAME full
  regenerate runs per pointermove tick (`gui_builder.js:3596-3598`; preview-dot
  drag too, :3694): the tick's own JS is only ~24 ms — the damage is the
  rebuild storm it triggers, ~2.4 s frame stall per tick, **0.4 FPS paced
  drag**, isolated batch-cache rebuild +20-25 ms/invalidate on 979 px.
  **Name↔chain parity** is already structurally right after `_42` (emission
  order = array order = drawer/model/patches order); the real gaps are a
  lexicographic "Group 10 < Group 2" sort in the 2D pixel-map lanes seeding,
  bare-number chain-viz labels, and a renumber-confirm that undersells
  sticky-by-name (engine ids + 2D anchors move too). **Rename hygiene**: a
  MAPPED group rename silently unmaps all N fixtures (rename makes the
  regenerate's casualty set the whole old-name set, gui_builder.js:4014-4019 →
  `unmapFixture` splices every chain entry, toast says "channels freed");
  hand-set addresses on unmapped scenes die the same way via the name-keyed
  `__globalPatchTree`, whose old-name keys then linger as phantoms;
  invalid chainSplits half-apply a rename; individual fixture renames have no
  mapping handling and no duplicate-name guard; and the operator's own
  'Right SmokeStacks' rename — clean only because titanic's registry is
  `controllers: []` — silently dropped the right chimney ring from the default
  Top-Down 2D view (`pixel_map_view_defaults.js:24-27` still names the old
  group; no matches-nothing warning renders). **Plan: 18 steps in 3 Opus
  slices** — slice 1 (objectChange rewire + COLD MOVE: regenerate once on the
  existing `dragging-changed` release seam; strands included, the `_2`
  move-trail fix preserved by release-always-invalidates + a mandatory
  regression test) ∥ slice 3 (numeric sort, label context, confirm text,
  operator-gated chain-sort/bulk-add); slice 2 (rename hygiene per the
  **operator ruling that arrived mid-session — "when renames happen, check
  the mapping and invalidate them too"**: deliberate check + loud
  fixture-by-fixture invalidation replacing the misleading toast, patch-tree
  phantom pruning, gate-before-mutate, invalidate-or-refuse individual
  renames + duplicate-name guard, pixel-map selector handling + loud
  empty-selector warning; the dead `renameFixtureInChains`
  (controller_registry.js:1093) becomes only an operator-gated OPT-IN
  "migrate addresses to new name" affordance, never the default) after
  slice 1 — shared main.js/gui_builder.js regions serialize. Timing gates, not pictures: select < 150 ms + 0
  regenerates, drag FPS ≈ idle FPS, before-numbers on file in `_44` §1.
  **Parity after his saves: the stale-titanic-model suite fail CLEARED**
  (979 px == scene-implied 979, drift/coverage spotless, 90 known unmapped
  errors, was 92); suite **805/803/2** — the 2 test_bench `metadata_drift`
  fails still wait on the queued ONE test_bench sim-save. Probe artifacts in
  `~/tmp/gen_ux_profile/`; zero save requests attempted, scenes/** mtimes
  untouched.
- 2026-07-29 — **R8 CHAIN ORDER IS NOW VISIBLE IN THE 3D SIM (`_43`,
  `20260725_43_chain_order_visualization.md`; `_42` §6 deferred item (b),
  scoped up from "sprite labels" to the whole cable).** With **Show Generators**
  on, every visible trace draws its **wiring**, not just its path: one coloured
  polyline per split walking the fixtures in daisy-chain order, a comet ramp
  **plus** an arrowhead on every step for direction (two cues, because an
  arrowhead foreshortens to a dot head-on and a ramp is ambiguous on a 2-light
  run), a dashed grey hop where the cable jumps between runs — without which
  three colours read as three separate cables — and the **post-renumber chain
  number** floating over each light, tinted to its run. The operator's Left
  Front Wall Generator reads as three runs at a glance: front-on, left to right
  along the path, `5 · 4 · 3 · 1 · 2` in violet / magenta / magenta / cyan /
  cyan, which is `_41` §4's table drawn. New pure module
  `simulation/src/dmx/chain_order_visual.js` sits on `_42`'s
  `generator_chain_order.js` and is **geometry-free** — it emits path positions
  and colours, `gui_builder.js` looks up the points it already computes for the
  preview dots — so the polyline point sequence is unit-tested in Node, and a
  test pins that the concatenated run positions are **exactly**
  `expandChainOrder` (one source of truth, two views). Palette (cyan / magenta /
  violet / mint / rose / ice) is test-asserted to collide with none of the trace
  editor's existing colour vocabulary. **Live update** rides the card's
  `refreshChainStatus`, so From/To steppers (on every tick), + Add split,
  − Remove last, ⇄ Swap and Regenerate all move the chain immediately.
  **Invalid splits draw NOTHING** — the generator refuses to build them and the
  red card badge is the loud channel; a plausible chain that will never be
  generated would be the forbidden fallback in picture form. **Perf contract
  honoured to the letter** (memory `sim-perf-per-object-explosion` + the `_38`
  finding that trace visuals linger invisible and still pay traversal): the
  overlay is **built on show and disposed on hide**, never `visible = false`;
  nothing is per-pixel (ONE vertex-coloured `LineSegments` carries all runs and
  the comet, ONE `InstancedMesh` carries every arrowhead, count−1 instances);
  drags rewrite buffers and instance matrices **in place** through hoisted
  scratch vectors, or re-parent the existing objects when a drag handler
  replaces the trace's group, so a pointer-move allocates nothing; and label
  textures/materials are cached and shared across every trace and rebuild.
  Scene census on titanic (walking the whole graph for `userData.isChainViz`,
  so it cannot be fooled by the feature's own bookkeeping): **1,487 objects
  overlay-off → 1,577 overlay-on**, +90 for 12 traces / 66 fixtures, and
  **exactly 0** whenever generators are hidden or the new **⛓ Show Chain Order**
  switch (in `📐 Group Generator`, on by default, runtime-only like
  `focusOnSelect` so it never reaches a scene file) is off. Honest: the 90 is
  dominated by the 66 label sprites and is a real ~6 % bump *while the trace
  editor is open* — which is why the switch exists. Sim suite **779 → 805
  tests, 802 pass, 3 fail** (+26 tests, **zero** new failures); parity verdicts
  byte-identical (`test_bench` FAIL, `titanic` FAIL, `studiodj` PASS) since no
  scene or model was touched. Live-proved on `:6969` as a browser client only
  via a triple-guarded zero-scene-write harness
  `agent_tools/chain_order_viz_verify.cjs`: **10/10 green**, **0 save requests
  even attempted**, pristine restore, every `scenes/**` file still at its
  pre-session mtime; screenshots in `~/tmp/chain_viz/` inspected; adapter
  recorded (SwiftShader software GL, `integrated: false`) and **no FPS
  claimed**. **⚠ BASELINE CORRECTION: the sim suite's pre-existing failure
  count is 3, not 2.** Measured before the first edit: 779 / 776 / **3**. The
  third is `real scene titanic: the model is fresh and complete…` —
  `models/titanic.js` carries 981 pixels while the scene now describes 977,
  orphaning `Left/Right Top Chimney Generator 9` and `… 10`, plus a
  `strand_missing_unpatched_marker` on `Left_Front_Left`. That is the signature
  of the operator's uncommitted titanic edits (both chimney generators 10 → 8
  lights) with the model not re-exported; like the two `test_bench`
  `metadata_drift` failures it **clears on one operator sim-save**, and it was
  left alone. Flagged for later in `_43` §7: `gui_builder.js` declares
  `destroyTraceObjects` **twice** in one scope (hoisting makes the second win;
  the first is dead code that still looks live), the overlay is busy at
  full-ship zoom if he ever wants labels limited to the selected trace, and the
  new toggle lives in only one of the two places `Show Generators` appears.
  **The `_42` renumbering semantic is still unratified — this overlay makes it
  visible, it does not decide it**, and the overlay survives the fallback design
  unchanged because it draws whatever `expandChainOrder` says.

- 2026-07-29 — **R8 GENERATOR CHAIN-ORDER SPLITS + ⇄ SWAP IMPLEMENTED (`_42`,
  `20260725_42_generator_splits_implementation.md`; 9 core steps of `_41` §7,
  3 optional/operator-gated deferred).** A DMX trace generator can now declare
  its **physical daisy-chain walk** as `chainSplits: [{from,to}…]` over the
  trace's 1..count path positions, and generation renumbers through it — so
  `<group> 1` is the first light on the CABLE, adding `1..N` to a port in plain
  numeric order IS wire order, and an already-mapped generator re-lands its
  sticky-by-name addresses on the wiring-true lights after one Regenerate. The
  operator's own example (4→5 / 3→2 / 1→1) produces exactly `_41` §4's table,
  confirmed live. `⇄ Swap start/end` is the SAME mechanism — one full-reverse
  split — and its label flips to `⇄ Restore path order` when active; pressing
  it back deletes the field entirely rather than writing `[]` (an empty list is
  a declaration covering nothing, which is invalid, not "absent"). New pure
  module `simulation/src/dmx/generator_chain_order.js`; **one deviation from
  the plan**, called out because it changes the export list: the emission seam
  `emitInChainOrder` was moved into the module so step 8's tests exercise the
  SHIPPING path instead of an oracle mirroring it — `generateGroupFromTrace` is
  a closure behind THREE and the DOM and cannot be unit-tested in Node. The aim
  math above the seam is a diff-visible no-op (the `parLights.push({…})` literal
  became a `pointData[i]` assignment with identical key order, so absent splits
  serialize byte-identically). UI: a collapsed `⛓ Chain Order (wiring)` folder
  on the generator card — read-only status row (`4→5, 3→2, 1 · covers 1–5 ✓` /
  `5→1 (reversed)` / `1..5 (path order)`), per-split From/To steppers, `+ Add
  split` / `− Remove last`, the Swap button, and an amber note whenever mapped
  fixtures would renumber — plus a card-level red `⚠ CHAIN SPLITS INVALID —
  <defect>` badge, so a boot-time skip is visible in the UI and not only in the
  console. **Nothing repairs itself (P0):** invalid splits refuse (re)generate
  BEFORE the undo push and before the sweep (alert interactively; at boot a
  `console.error` and that trace's regen skipped, saved fixture rows left
  exactly as they are), and a `Lights` count change that would invalidate the
  splits reverts the slider and KEEPS them. The add/remove buttons are total by
  construction — add halves the last split, remove merges it back into its
  predecessor or clears the field — so a button can never write an invalid list
  (hand-editing From/To still can, and goes red). Validator gains one family,
  `generator_splits/invalid_cover` (ERROR in both modes, arithmetic re-stated
  independently of `src/` per the gate's own design rule); it adds **zero**
  findings to every committed scene, because none carries `chainSplits` yet, and
  the parity CLI verdicts are unchanged (`test_bench` FAIL 4, `titanic` FAIL 92,
  `studiodj` PASS). Zero registry / panel / projection / `patches.yaml` /
  exporter / engine / CaptainPad change — chains stay ordinary `{fixture, at}`
  entries, so the `_35` drift check reads splits' EFFECT natively. **Sim suite
  721 → 779 tests, 777 pass, 2 fail — the SAME two pre-existing `test_bench`
  `metadata_drift` failures (`TE Sign V3 A/B`, the half-applied `_34` id repair
  still awaiting the operator's sim-save, deliberately not touched); 58 new
  tests, zero new failures.** Live-proved through the REAL GUI on the operator's
  `:6969` as a browser client only — his stack never restarted, probe browser
  closed — with a new triple-guarded harness `agent_tools/generator_splits_verify
  .cjs` (autoSave off + `debounceAutoSave` stubbed + every `:6970` request
  aborted at the network layer, pristine deep-clone restored at exit): **9/9
  checks green, 0 save requests, `parLightsMatch`/`tracesMatch` true, no probe
  residue**, and every file under `simulation/scenes/` still carrying its
  pre-session mtime. Screenshots in `~/tmp/generator_splits/`, inspected by eye:
  the card matches `_41` §6's mock, the reversed state, the mapped-fixture
  warning, and the invalid state showing the defect both in-folder and on the
  card. Adapter recorded per the `_39` ops rule (SwiftShader software GL,
  `integrated: false`) and **no FPS number claimed anywhere**. **⚠ STILL OPEN —
  the renumbering semantic is UNRATIFIED (`_41` §8): a fixture's NUMBER now
  means its position in the physical daisy chain, not along the drawn path.**
  Built as designed because that is what makes the retroactive fix work and it
  matches DMX-tech convention, but no code can decide it for Sina, so the
  confirm dialog states it verbatim before any mapped group renumbers. If he
  wants path-order numbering preserved, `_41` §2 option (a) is the fallback at
  the same UI cost minus retroactivity, and would be an emission-seam rewrite
  only. **Deferred, needing his call, not more work (`_42` §6):** (a) the
  group-level `+ gen (numeric order)` bulk-add — the step that actually cashes
  in the prospective half, and which touches the 2026-06-11 "no group-level add"
  ruling; (b) chain-number sprite labels on preview dots; (c) an
  order-vs-addresses `warning` check (left out on purpose — manual address pins
  are legal overrides and it would fight them); (d) a `⟲ Remap group in chain
  order` panel tool, probably unnecessary now. Notion cards for (a)–(d) and for
  the `chainSplits`-vs-`trace.splits` vocabulary reconciliation (`_41` §1.6)
  **could not be filed — no Notion MCP tools in this session.** No git ops.
- 2026-07-29 — **R8 GENERATOR SWAP + SPLITS DESIGN DONE (`_41`,
  `20260725_41_generator_swap_splits_design.md`; Fable design → Opus `_42`
  implement).** Operator's Phase-B mapping ask (swap start/end button;
  splits = subsections with start/end controlling addressing/chain order,
  count unchanged) designed as ONE mechanism: `chainSplits` on the trace
  renumbers fixtures at generation time so fixture number = daisy-chain
  position — retroactive for mapped generators (registry addresses are
  sticky BY NAME, docs/33 decision 19, so a Regenerate relands existing
  addresses on the wiring-true lights) and prospective (numeric add order =
  wire order). Swap = the full-reverse split. Exact-cover validation or
  loud refusal (UI + boot + new `_35` validator check `generator_splits`);
  count changes that invalidate splits are refused, splits never silently
  dropped. No registry/panel/exporter/engine changes; LED chains explicitly
  out of scope (their order is load-bearing, docs/41 §3). Prior art found:
  studiodj chains already hand-split generator groups across ports with
  reversed runs. Recommendation to operator: build splits — under this
  design they are small (pure module + card UI + emission permutation) and
  a swap-only feature would leave segment wiring unsolved; ratify the
  renumbering semantic (`_41` §8). 12-step plan in `_41` §7.
- 2026-07-29 — **2D Pixel Map: chimney par rings moved onto their cluster, bar
  segments beefier (`_40`, operator-requested, display-only).** Two annotated
  screenshots, two fixes, no behaviour outside the 2D map. **(1)** The fixtures
  the operator drew as "rings of small dots parked far to the right" are the two
  10-par chimney groups (`Left`/`Right Top Chimney Generator`), and they were
  there because the shipped `top_down` default put them in a **separate
  `weight: 1` `radial` "Smoke Stacks" panel**, which re-normalises world
  coordinates into its own little box. Probing the live rig showed the request
  was not "fake a position" but "stop faking one": the left ring occupies world
  x −24.9…−19.7 / z 5.8…11.5, dead inside its strand fan at x −31.5…−13.5 /
  z 3.8…13.5 (right ring likewise). So the fix is to let the pars ride the SAME
  projection as everything else — `top_down` is now **ONE `spatial` panel**
  selecting bars + strands + both chimney groups, and `expandPanel`'s
  whole-panel TRUE world projection drops each ring exactly at the centre of the
  cluster it crowns, with nothing to keep in sync and nothing that can drift.
  Par extents are strictly inside the strand extents so the aspect-preserving
  fit box is unchanged and nothing else on the view moves; with the second panel
  gone the map also gets the whole pane. A **per-fixture 2D placement override
  was explicitly rejected** — `spatial` ignores `view.placements` by design, so
  using one would have meant demoting the panel to an editable layout and
  hand-placing 20 pars, i.e. hard-coding a copy of a truth the projection
  already computes, which rots the first time a stack moves. One knob was
  genuinely needed and used the existing affordance: a **per-view `typeStyles`**
  entry shrinks `UkingPar` to 13 **on `top_down` only** (at whole-ship scale the
  shipped 24-unit disc fused the ten dots into a solid donut); the `front` view
  was screenshotted to confirm the full-size par is untouched there.
  **(2)** `TYPE_STYLES.ShehdsBar` **13 → 17** (+31 % linear) — uniform so bar
  pixels stay square and a bar reads thicker at ANY rotation, and in design
  units so it scales with zoom rather than being a fixed screen weight; in
  `spatial`/`planar` a bar's *length* comes from world coords, so this is
  thickness plus ~4 units of end-cap. No other glyph type touched (strand,
  TE-sign, vintage, par all unchanged). **Free win:** deleting the `stacks`
  panel also removes the red *"Panel 'stacks': no fixtures match its selectors"*
  banner that ate a quarter of the pane on every scene without chimney groups —
  visible in the test_bench before shot, gone in the after. **Verification** per
  `.agent/skills/see_the_world.md`: fresh puppeteer browser per run, closed
  after, purely as a browser client of the operator's live `:6969` (his stack
  never restarted), adapter recorded on every run as
  `ANGLE (NVIDIA GeForce RTX 4090 Laptop GPU, D3D11)` / `integrated: false`.
  Before+after for titanic Top-Down and test_bench Top-Down plus a titanic Front
  sanity shot, all inspected, in `~/tmp/pixel_map_2d_tweaks/`. Sim suite
  **721/721, 0 fail** immediately after the change — the stated baseline held
  exactly. Test updated, not deleted: the case that pinned the two-panel
  `top_down` now pins the one-panel spec (panel ids, layout/projection, 24+16+20
  clusters, both rings present, deck pars NOT dragged in by the group selectors,
  the per-view par style). **Flagged, and NOT caused by this change:** a later
  suite run read 719/2 in `scene_model_parity.test.js` (which imports none of
  the pixel map). Opening the `test_bench` scene in the sim re-exports
  `marsin_engine/models/test_bench.js`, and the verification run did exactly
  that — surfacing a **pre-existing sId/fId collision** in the uncommitted
  test_bench scene: the two LED strands hold `sectionId 5/6, fixtureId 11/12`,
  the very ids `patches.yaml` still assigns TE Sign V3 A/B, so the exporter
  renumbers the sign to sId 7 / fId 13,14 and the validator raises
  `drift/metadata_drift` ×2. Left unrepaired **on purpose**: which ids win is an
  operator mapping decision (R8 territory, `_34`), the model file also carries
  uncommitted operator work so `git checkout` would destroy it, and the codex
  forbids hiding a side effect. Repair path: settle the ids in
  `scene_config.yaml` / `patches.yaml`, re-save the scene, then
  `node simulation/tools/scene_model_parity.cjs test_bench` until green.
  **Operator action:** reload the 2D Pixel Map view — `src/` is served from
  disk, so a browser reload picks both fixes up; no server restart.

- 2026-07-28 — **R9 GPU-ADAPTER VISIBILITY LANDED (`_39`) — the sim now names
  the GPU it is rendering on, so this can never masquerade as a code
  regression again.** Executes `_38` §4 steps 1-4 with **zero rendering
  changes** (no shader, material, light, pass, profile or loop-order edit; the
  only touches to existing files are two imports, a 9-line boot block after
  `renderer.init()`, and one branch inside the existing once-per-second FPS
  badge block). Boot detection sets `window.__gpuAdapter =
  { renderer, integrated, detectionFailed }` (WebGL2 `WEBGL_debug_renderer_info`
  probe, WebGPU `adapter.info`, probe context released) and logs one line —
  `console.log` when discrete, `console.error` when not. Integrated **or
  unnameable** adapter → a red top-center `#gpu-adapter-warning` banner naming
  the GPU and carrying the Windows remedy verbatim; an adapter the browser
  won't identify is its own loud state, never silently treated as healthy. A
  fire-once `[LowFPS]` `console.error` after **10 consecutive seconds under
  20 FPS** names the adapter as well — the one signal that also catches the
  *right* adapter under contention (leftover probe browsers, extra sim tabs).
  Nothing auto-falls-back (P0): the sim renders exactly as before and simply
  refuses to be quiet. **Verified live on BOTH adapters** of the operator's box
  by `--use-adapter-luid` (his :6969 never restarted, both probe browsers
  closed, no stray processes): dGPU = **59.9 FPS, no banner, `(discrete)`
  log**; Intel-pinned at 2000×1125 = **15 FPS, banner up naming
  `Intel(R) UHD Graphics`, boot `console.error`, and `[LowFPS] 16 FPS — under
  20 FPS for 10 consecutive seconds …`** — screenshots show the identical scene
  in both. Sim suite **698 → 721 / 0 fail** (23 new tests: real adapter strings,
  Apple Silicon + AMD deliberately not flagged, unknown-adapter handling, and
  the latch's hitch-quiet / fires-once / never-re-arms contract). Rule wired
  into `.agent/ops/sim_auto_checks.md` and `.agent/skills/see_the_world.md`:
  **an FPS number reported without `window.__gpuAdapter.renderer` is not
  evidence, and `integrated: true` invalidates the measurement.** Gaps stated
  honestly in `_39` §5 (SwiftShader not banner-flagged, discrete Intel Arc
  would false-flag, exactly-20 FPS doesn't trip the escalation, one shot per
  page, adapter read once at boot). **Still open and only Sina can do it:**
  Settings → System → Display → Graphics → add `chrome.exe` → High performance
  → restart Chrome → `chrome://gpu` shows NVIDIA `*ACTIVE*` (10 → ~60 FPS).
  Full detail: `20260725_39_gpu_adapter_visibility.md`.
- 2026-07-28 — **R9 "TITANIC SIM AT 10 FPS" ROOT-CAUSED (`_38`) — GPU adapter,
  not code.** The operator's URL renders **59.9 FPS on the RTX 4090 in every
  probed configuration** (WebGL/WebGPU, 1600×900 and 3200×1687, gradient and
  sacn_in, 110 s sustain with a byte-identical 1,515-object census, and under a
  synthetic 24-universe×40 Hz sACN influx of 12,312 frames) — and **10.0 FPS
  when Chrome is pinned to the Intel UHD iGPU at fullscreen-scale canvas**,
  numerically matching the report. The `20260724_6` instancing is intact
  (267 InstancedMesh / 3,530 instances; drawCalls 3,427 vs 3,413 baseline).
  Dual-GPU laptop + no Windows per-app GPU preference for Chrome = the adapter
  silently drifts; `powerPreference:"high-performance"` is already requested
  and cannot move an already-placed GPU process. Fix = visibility (adapter log,
  loud integrated-GPU banner, sustained-low-FPS error naming the adapter, ops
  rule that FPS reports must record the adapter) + Sina's one-time Windows
  Graphics setting for chrome.exe. Full matrix, mechanism, honesty notes and
  the numbered Opus plan in `20260725_38_titanic_sim_fps_regression.md`.
  Side finding, chip filed: the engine claims sACN streaming to 127.0.0.1 at
  39 fps but the :6971 bridge forwards ZERO frames — sacn_in shows undriven
  red no matter what tonight.
- 2026-07-28 — **R2 PARAMETER TRUTH SWEEP DONE (`_32`) — 817 params, 125
  patterns, "do the sliders do what they say?" answered with numbers.** Built
  `marsin_engine/tools/param_truth/`, an offline behavioural verifier: it loads
  every pattern into the engine's own WASM VM (reusing `loadModelForGauge`,
  `buildMaskConstants`, the `inView` table and `parsePatternDefaults`, so the
  baseline is the live engine's baseline), sweeps each declared `slider*` across
  5 points × 144 frames, measures the rendered light, and checks the measurement
  against what the parameter's NAME claims. The pattern list always comes from
  disk discovery, never a hardcoded list, because the pattern set is being
  renamed into themed subdirs. Fully offline — no socket, no port — so it ran
  alongside the operator's live stack; sharded across 12 workers it completes in
  **183 s**, which is the difference between a one-off audit and a check the
  curator can re-run after every edit. **Result: TRUE 548 (67.1 %) · DEAD 170 ·
  WRONG 39 · UNKNOWN_CLAIM 35 · WEAK 25.** The DEAD split three ways and only one
  is a pattern bug: **137 = ship-model coverage gap** (controls gated on
  `sectionId == 2`; every titanic pixel reports `sectionId 0`, so they measure
  TRUE on `test_bench` and byte-identical on the ship — independent
  corroboration of `_33`), **9 = buried by a shipped default**, **25 = hard
  dead**. Three probes exist specifically to stop false accusations: a *trigger
  probe* (pulses the control, because `29_kick_shockwave` arms on
  `kick >= 0.5 && prevKick < 0.5` and a held slider fires nothing **by design** —
  rescued 3), a *mid-range probe* (because `12_breathing` ships `level = 1.0` →
  gain 2.32 → saturated `bri`, so its `kick` is provably alive at level 0.5 and
  invisible at its own default), and *cross-model reconciliation*. Four
  measurement gaps were found and fixed mid-run, each having produced false
  verdicts: direction judged on min/max instead of range ends (and a ping-pong
  sweep nets to ~0 drift in **both** directions, so an anticorrelation path was
  added); no edge-sharpness feature, which made every transition's
  `sliderFeather` read DEAD (10 false DEADs — transitions also turned out to
  render through `renderBlend6ch`, not `renderAll`, with `progress` pinned at 0;
  blend patterns are now detected from SOURCE, not path, so a folder rename
  can't break it); contrast measured absolute spread when the claim is relative;
  darkness measured luma only, ignoring pixels pushed to black. Verified in
  source: `22_abyssal_sway_garden/sliderBaseDarkness` is **inverted**
  (`glowFloor = 0.04 + baseDarkness*0.08` — "darkness" ADDS light),
  `13_sparkle/sliderAmberGlint` is dead because the `_26` lane-match
  `a = clamp01(w)` overwrites it. Every threshold is absolute, documented in one
  place, and echoed into the results file; nothing was tuned per pattern (the one
  borderline case, `trans_iris_close/sliderFeather` at 0.0197 vs 0.020, is
  reported as WRONG rather than absolved). Artefacts:
  `tools/param_truth/param_truth_results.{json,md}` (keyed by pattern id + param
  name, diffable) + `README.md`; CI smoke
  `tests/patterns/param_truth_smoke.test.js` (8 tests, 6 s) guards the machinery,
  deliberately **not** a verdict census, since pattern files are the curator's.
  Engine suite: the **same 8 known-env fails from `_31`** reproduce every run,
  new smoke passes 7/7. **⚠️ Side finding worth a follow-up: the "same-8" bar is
  not stable.** Adding *any* test file — proven with a trivial 3-line no-op —
  tips `timeline_deck_release_default_cue` (and up to 5 more) into failing ~2/5
  runs; that file passes 9/9 in isolation in 156 ms and dies in-suite with
  `uncaughtException: Unable to deserialize cloned data`, thrown inside node's
  own `FileTest.parseMessage` — the SAME runner IPC defect as the 5 documented
  audio fails, merely re-exposed by parallel-scheduling reshuffle. So any agent
  adding a test will look like it caused a regression it did not. Suggest
  capping `--test-concurrency` or pulling the chatty timeline/audio files out of
  the parallel pool. **No pattern file modified** — the punch-list is the
  curator's to act on.
  Highest-leverage next step is **R8 model mapping**, which revives 137 dead
  parameters at once. Report: `_32`.

- 2026-07-28 — **R8 Phase A slice 4 LANDED: bench-as-section sync tool +
  `0.0.0.0` sentinel refusal (`_37`, Opus).** The bench can now become a
  section of another scene without a hand-maintained copy:
  `node simulation/tools/bench_section_sync.cjs` derives a `TB `-prefixed block
  from the **test_bench scene, which stays the single source of truth**, and the
  copy is only ever changed by re-deriving. Offline, no browser, no stack.
  **Idempotent and proven so**: two runs are byte-identical (7,911 bytes,
  digest `3610e53583fd…`), reversing the source's key and array order changes
  nothing, and the digest covers the INVARIANT projection only — so recolouring
  a par or a `device.lastPush` update from a real LED push is not drift, while
  moving one chain address is. A genuine hazard surfaced by a failing test:
  the bench stores `rotX: -0.0`, whose sign YAML keeps and JSON/the digest
  discards, so two blocks could agree on their digest while emitting different
  bytes — negative zero is now normalized at derivation. The design is a
  deliberate **three-tier field split**: INVARIANT (ip/type/protocol, port,
  universe, startAddress, **chain order**, chain names, `at` addresses, the
  `led:` wire block, `device:` binding, fixtureType, pixel counts) is
  parity-enforced; TARGET-LOCAL (placement, colour, brightness) is seeded then
  owned by the operator and never a failure; and section/fixture/view/controller
  ids plus `device.lastPush` are **stripped**, because they are re-derived by
  the TARGET registry — importing the bench's `sId 5/6, fId 11/12` into titanic
  would drag slice 1's collision across a scene boundary. **Refuses rather than
  reconciles**, with distinct exit codes: 2 = the bench contradicts itself
  (10 falsified checks — chain orphan, controllers↔patches address/universe/IP
  mismatch, orphan patch, double-chained fixture, ledCount ≠ pixelCount,
  segment-sum, out-of-range address, no controllers; the real bench is clean on
  all), 4 = target collision (`TB ` squatter, a fixture on bench-reserved
  U1/U2/U10/U12, view-budget overflow), 3 = an applied block someone hand-edited
  (reported as dotted diff paths, e.g.
  `controllers[0].ports[0].chain[0].at: derived=1 target=250`; a dropped chain
  member and an edited wire block are caught too), 5 = `--strict` with
  placeholders remaining. Per the plan's step boundary the block is **NOT
  applied** to titanic — `--apply` refuses and points at Phase B step 6.
  **Sentinel half — the plan's UNVERIFIED item, now verified and worse than
  assumed:** the bridge never *sent* to `0.0.0.0`, it dropped it in **silence**
  on one inline condition that also swallowed loopback, so an operator staring
  at dark hardware could not tell "no controller declared" from "declared, route
  discarded". `classifyRouteIp`/`partitionRoutePairs` now classify `sentinel` /
  `missing` / `broadcast` / `loopback`, each with a reason, and the bridge logs
  **one named warning per (scene, universe, ip)** — naming the fixtures that
  asked for the dead route — to console and the monitor panel. The refusal set
  is deliberately tight (hostnames still route); measured across all seven
  scenes with a `patches.yaml`, route counts are **identical** and refusals are
  **zero** today — the loudness only appears once Phase B authors the first
  placeholder controller. **Cross-checked against slice 2 rather than merged
  into it** (sibling's file, untouched): the derived block yields **0**
  bench-parity findings in `checkSceneModelParity`, and a mutated address
  produces exactly the drift error this tool refuses;
  `compareBenchSection` is the stricter superset, so the follow-up is to have
  the validator's check 6 delegate to `lib/bench_section.cjs` instead of keeping
  two hand-synced definitions of "invariant". **Phase B blocker found:** titanic
  is at 23 view bits, the bench block adds 7 → **30/31, one spare**, and step 5
  still wants named audit views that consume the same bits — applying the block
  *and* authoring more than one custom view overflows the 31-bit export ceiling.
  The tool reports the budget every run and refuses on overflow rather than
  letting the exporter throw later. **Tests: +45** (39 new
  `bench_section_sync.test.js` + 6 added to `bridge_routing.test.js`, 10 → 16);
  full sim suite **698 pass / 0 fail** with all four Phase A slices interleaved
  (baseline at slice start was 591). `sacn_bridge.js` was edited but never
  executed — the operator's live stack was not touched, so the bridge change
  rests on unit tests over the pure seam plus a scene-wide route-count
  comparison; a live confirmation belongs to the Phase C smoke. Report `_37`.

- 2026-07-28 — **R8 Phase A slice 2 LANDED: scene ↔ engine-model parity
  validator (`_35`, Opus).** The mapping campaign now has an acceptance gate:
  `node simulation/tools/scene_model_parity.cjs <scene> [--strict]`. Nothing in
  the repo previously checked a generated model against the scene it was
  generated from — the engine validates only `groupBits` ↔ model groups at
  load and REFUSES a pixel-count change on hot reload, the exporter aborts only
  on internal inconsistency, and the unit tests pin serialization. A stale
  model, a duplicate DMX address, an unmapped fixture, a hand-edited
  `patches.yaml` or a DMX/LED id collision all passed silently. Eight check
  families now fail loudly with located, actionable findings: **coverage**
  (the pixel roster PREDICTED exactly from the scene plus the fixture-definition
  YAMLs — count, order, per-pixel name, group, `localIndex`, channel map — so
  the check is byte-faithful, not a plausibility test), **patch truth** (model
  patch == `patches.yaml`; per strand the no-straddle contiguous walk, the
  recorded `endUniverse`/`endChannel`, the `segments` partition, and the
  stride / channel order / `whiteMode` / `ledWire` implied by the owning
  controller), **address hygiene** (1–512 with the footprint fitting, universe
  range, controller existence, malformed/duplicate IPs, orphan chain entries, a
  fixture in two chains, the occupancy sweep, and **unmapped fixture/strand as
  an error** — an unmapped fixture emits no sACN at all, which IS the "no data
  from sacn_in" symptom), **metadata** (nonzero `cId/sId/fId` on patched pixels,
  group↔section bijective, no DMX/LED `sId`/`fId` collision — the `_4`/`_34`
  regression guard), **views** (`views.yaml` ↔ model groups ↔ the
  `.viewmasks.js` sidecar, bits power-of-two/unique/≤`0x40000000`),
  **bench parity** (a `TB ` block against the test_bench source on invariant
  fields, so slice 4's derived copy cannot drift — and an unprovable copy is
  not a passing one), **placeholder policy** (`0.0.0.0` is info by default and
  an error under `--strict`, the hardware gate; a sentinel IP without the
  `PLACEHOLDER` name marker, and the dangerous inverse — a `PLACEHOLDER`-marked
  controller carrying a REAL ip that would actually transmit — fail in both
  modes), and **drift** (exported `pixelCount`, the effects sidecar, model
  metadata vs the YAML it came from, and `patches.yaml` re-derived from the
  `controllers.yaml` chains plus the `global_effects` pin rule — catching the
  hand-edit `_4` proved futile but that nothing detected). Deliberate
  architecture call: the gate imports **nothing** from `simulation/src/`,
  because a validator that re-runs the code it audits will happily agree with
  the exporter about a wrong answer; every rule is re-stated independently with
  a comment citing its source module. That also kept it runnable while the
  sibling sId/fId slice was rewriting `controller_registry.js` and `main.js`
  underneath it, mid-signature-change. Verdicts on the tree as committed:
  **test_bench FAILs with 8 errors** — the 2 unmapped TE Sign fixtures (O5, the
  sign is still being assembled) plus the 4 sId/fId collision findings, which
  correctly still stand because slice 1's fix reaches the artifacts only when
  the operator does one sim-save (the model generator is the browser exporter);
  **this validator is what will prove that repair landed**, all four findings
  must go to zero. **titanic FAILs with 92 errors** (100 under `--strict`) —
  84 unmapped fixtures + 8 unmapped strands, and nothing else. The
  load-bearing half of both verdicts is what is CLEAN: coverage, patch truth,
  views and drift report zero errors on both scenes, independently confirming
  `_33` §1.4 that the titanic model is a fresh, complete, faithful 981-pixel
  export and the gap is purely electrical. Phase B authoring now has a number
  to count down: 92 → 0. Two false-positive bugs were found by running it and
  fixed before landing (`fId` collisions keyed on pixel name instead of the
  owning fixture; bare-string chain entries flagged as legacy-packed on LED
  ports, where they are the normal shape) — both now covered by tests, and
  worth recording because a gate that cries wolf is worse than no gate. 52 new
  tests: a synthetic parity-clean scene asserted spotless in both modes, then
  one mutation per check family asserting the SPECIFIC code, plus real-scene
  tests that assert the SHAPE of each verdict (which families must be clean,
  every remaining error on a known-open list) rather than an exact defect
  count, so the suite survives the campaign fixing scenes one at a time. Sim
  suite 698 pass / 0 fail. Ops wiring: `.agent/ops/sim_auto_checks.md` gains a
  "Scene ↔ Model Parity Gate" section and a done-bullet;
  `.agent/ops/marsin_engine_auto_checks.md` gains "Model Files Are Generated —
  Run The Parity Gate". Report: `.agent/reports/202607/20260725_35_scene_model_parity_validator.md`.

- 2026-07-28 — **R8 Phase A slice 1 LANDED: DMX/LED sId/fId collision fix
  (`_34`, Opus).** DMX fixtures and LED strands share ONE section/fixture id
  space, and only one of the two passes that mint into it knew that.
  `led_metadata.js::assignLedStrandMetadata` floors its counters at the DMX
  max (safe by construction); `controller_registry.js::projectOntoConfigs`
  took its max over **DMX configs only**, so any DMX fixture added *after*
  the strands were numbered was minted straight on top of a strand id — and
  stickiness then made the collision permanent across every re-save, re-export
  and reboot. The shipped model proves it: **40 `TE Sign V3 A` pixels and 20
  `LED_0` pixels both carry `sId 5, fId 11`**. Operator-visible symptom:
  `GET /dimmer-groups` returns `TE Sign: 5` *and* `LED_0: 5`, so the Dimmer
  Rack shows its "🔗 SHARES SECTION 5" badge and **both faders drive the same
  section** — dimming the sign dims the strand. Fixed by flooring over the
  **same DMX ∪ LED union** the LED pass uses, plus a one-time repair of the
  ids the old pass already baked into stored scene data: the DMX side yields
  (only it could ever have minted blind, so the repair undoes exactly the
  bug's damage and nothing else), a whole section moves together so
  group↔section stays bijective, every move is reported in a new `collisions`
  return field and logged loudly by `main.js`, and the pass is idempotent —
  which matters, because the sim re-projects and re-saves scene YAML on every
  page boot. `ledStrands` is a **required** argument now: a default `[]`
  would be a silent fallback that re-opens the bug, so a non-array throws
  (codex P0), validated *before* the inactive-registry early return so an
  inactive registry can't hide the misuse. Blast radius, measured on the
  committed YAML of all seven scenes with a `patches.yaml`: **only test_bench
  changes** — `TE Sign V3 A/B` move `sId 5→7`, `fId 11→13` and `12→14`, while
  LED_0 keeps 5/11, LED_1 keeps 6/12 and the other ten fixtures keep every
  stored id; studio, studiodj, studio_top_loft, summer_camp_dome,
  summer_camp_logsville and **titanic** (84 fixtures + 8 strands, all ids `0`)
  export identical models. Titanic gains nothing today and that is the point:
  its Phase B authoring can no longer mint a collision at 84-fixture scale.
  Sim suite **591 → 601 pass / 0 fail**; the 10 new tests (6 unit + a new
  cross-module `tests/section_fixture_id_space.test.js` that owns the seam
  neither existing test file covered) were falsified against a pre-fix copy of
  the module — 8 fail there, while the two contract tests correctly pass on
  both sides. Consumer audit across engine, CaptainPad, sim and every tracked
  state file: **no pattern is affected** (every `sectionId` comparison in
  `patterns/`/`og_patterns/` tests 0–3 only; an explicit grep for ids ≥4 and
  every 5/6/7/11–14 literal returned zero hits) and all runtime consumers
  re-derive ids from the model each load. Two exceptions, reported not
  touched: the raw numeric `dimmers` maps in
  `marsin_engine/states/test_bench/globals_state.yaml` and its
  `performance-preshow` snapshot go stale when the ids move (behaviour change
  today is nil — both keys are `1.0` and the intensity controller skips the
  multiply at `scale >= 1.0`). Deliberately **not** re-exported: the model
  generator is the browser exporter and there is no headless path, so
  hand-editing `patches.yaml` would only make scene and model disagree —
  instead **one operator sim-save on test_bench** logs the four repair
  warnings and rewrites `patches.yaml` plus the three model files atomically.
  Follow-ups filed in `_34` §8: the parity validator should also flag a
  persisted `viewSelection {type:'section', target:N}` whose N is absent from
  the model (latent, unused today), and `POST /section-brightness` writes
  `dimmers[sectionId]` with no model validation, so orphan keys accumulate

- 2026-07-28 — **R8 Phase A slice 3 LANDED: same-scene model reload +
  curator refresh runbook (`_36`, Opus).** The engine can now be told,
  deliberately, to apply a re-exported model of the scene it is already
  rendering: `POST /scene/reload {"scene":"<active>"}`. It exists because the
  on-disk watcher REFUSES a pixel-count change (goes `modelStale`, keeps the
  old model live — the render loop and WASM buffers are boot-sized) while
  `POST /scene` with the active scene is a no-op; the only prior workaround
  was bouncing to another scene and back (two restarts). The reload runs the
  ONE sanctioned restart path — `requestSceneSwitch` → graceful shutdown →
  supervisor handoff file + **exit 75** (or detached self-respawn when
  standalone) — so it re-binds the same ports with the same argv and never
  starts a second engine or frees a port any other way. Deliberate by
  construction: the caller must NAME the active scene (mismatch = 409
  `SCENE_MISMATCH`, never an implicit switch), performance mode blocks it
  (409 `PERFORMANCE_MODE` — a live show is never restarted), missing model
  404s, path names 400 — every refusal carries a machine-readable `code`,
  changes no state, and never falls back. `POST /scene` on the active scene
  keeps its no-op and now returns a `hint` naming the new route. Guards live
  in a pure exported seam (`sceneReloadDecision`) beside the engine's other
  decision helpers; `engine.js` changed by comment only. **Runbook**
  `.agent/ops/engine_model_refresh.md` — written for the operator AND the
  curator (`.agent/roles/curator.md` engine rights): which of the two cases
  you are in (same pixelCount hot-reloads automatically — do nothing), the
  parity-validator gate (sibling slice; flagged, never silently skipped),
  poll-until-back, **STOP and report if it does not return**, and the hard
  limits — never a second engine, never free/steal 6966-6972 or 5568, never
  kill an engine process directly, never work around the performance-mode
  409, never scene-bounce as a substitute, and the honest cost (a reload IS a
  full restart: output drops for the shutdown+boot window, deck reboots from
  saved state — batch changes, reload once). **Tests: 18 new.** 11 pure (full
  guard matrix, guard ordering, both restart modes, "no refusal ever reports
  `restart:true`") + 7 driving a REAL engine spawned on an **OS-assigned free
  port** (52715 on the run of record) with `--dest 127.0.0.9` black-holing
  sACN and state redirected to temp dirs — the operator's live stack
  (6966-6972, 5568) was never touched and the tracked `states/` tree was
  asserted unmodified. Proven live: each refusal leaves the engine answering
  `/status` on the same model; performance mode blocks the restart; the
  accepted reload acks `{restarting:true, mode:'supervised-handoff'}`, exits
  **75**, and writes `{"scene":"summer_camp_dome"}` to the handoff file — with
  the suite asserting nothing is left listening (orphan-free by construction:
  supervised mode hands the respawn to a launcher that is absent in tests).
  Engine suite **2373 tests / 8 failures = the known-8 baseline** (`_31`),
  none in touched files. Also corrected the stale `now.md` note "restart the
  launcher after any Save that changes universes" — universe changes hot-reload
  fine since G10; the real restart trigger is a **pixel-count change**.
  Honest gap: the standalone (unsupervised) self-respawn branch is NOT
  exercised live — doing so would leave a detached engine holding a port and
  `/status` exposes no pid to kill it reliably; it is unchanged pre-existing
  `POST /scene` behaviour and is covered at the decision level. Flagged for a
  sibling/follow-up: `tests/mixer/performance_mode.test.js` spawns its engine
  in the **6960-6989** range, which overlaps the show ports.
- 2026-07-28 — **R8 OPENED: Titanic scene mapping + bench section — investigation
  + plan DONE (`_33`, Fable).** Root mechanics of the operator's "no data from
  sacn_in on titanic" proven at every layer: `scenes/titanic/controllers.yaml`
  is `controllers: []`, so the controller registry never activates,
  `projectControllerMappings` early-returns (`simulation/main.js:401`), the
  (otherwise FRESH, 2026-07-25) model exports all 981 pixels `patch: null` with
  zeroed cId/sId/fId/vMask, the engine's universe send set (built from model
  patches, `engine.js:1313-1333`) is empty for titanic, and the sim demap paints
  undriven red. Everything needed to author the mapping already exists
  (Controllers panel is the only authoring surface — patches.yaml is re-derived
  on every boot; sticky group→sectionId; views auto-reconcile; browser-only
  exporter → `:6970/save-model`, no headless path). Gaps found: DMX/LED
  sId/fId collision bug (`_4`), zero scene↔model validation anywhere, no
  same-scene engine reload (`POST /scene` same-scene is a no-op; pixelCount
  changes refuse hot-reload), bridge universe subscription is boot-time.
  Decisions in `_33`: bench-as-section = derived `TB `-prefixed copy from an
  idempotent sync tool with a hard parity gate in the new validator (scene
  import/include rejected — save-server re-extract risk); placeholder strategy
  = real universes + `0.0.0.0` sentinel IPs, which unblocks the ENTIRE sim-side
  pattern audit before any wiring facts (hardware relay is the only consumer of
  IPs), bridge must refuse sentinels loudly, `--strict` validator = the
  hardware-ready gate. Plan: 9 steps / 3 phases; Phase A = 4 parallel
  worktree slices, Phase B = operator-present mapping session, Phase C = E2E +
  placeholder retirement. Operator input list O1–O9 (controller inventory,
  output wiring, universe budget, smokestack rope px counts, TE sign wiring,
  Art-Net-vs-sACN, `.202`-vs-`.60` LED controller identity, 20-vs-40 px
  strands, bench presence during audits) — none block Phase A.
- 2026-07-28 — **VSN1 CRLF overflow FIXED + MIDI attach state SHIPPED (`_31`,
  Opus) — `_30` plan steps 1–10 + 12 landed; step 11 deferred for operator
  sign-off.** The 5960-vs-909 overflow is closed at the root:
  `stripLineComments` now splits on `/\r?\n/`, so CRLF is harmless forever, and
  all nine templates compile back to the July-15 known-good sizes (encoder INIT
  **904/909**, key INIT 871, lcd_draw 573, system 626) — Fable's own
  `measure_templates.cjs` went from **6 templates OVER budget to zero**. The
  worse hazard (`_30` §2.7) is now unshippable via a fail-loud
  comment-survival guard, and the danger is asserted rather than argued: on a
  script whose entire body ends up inside a surviving comment,
  `GridScript.checkSyntax()` returns **`true`** — it would have flashed dead
  code with green lights. `.gitattributes` (`*.lua text eol=lf`) ends the drift
  class. **Attach state now exists**: `attached|detached|unknown` from a
  short-lived `probe_vsn1.cjs` child (exit 0/3/1, enumerates ports and never
  opens one) at boot, every flush drain and `POST /global-effects/deploy` —
  serial stays out of the engine process, so the crash isolation that has kept
  device faults away from the show is preserved. `detached` clears
  pendingPages, sets `skipped-detached`, logs **exactly one** line per
  transition, spawns no deploy child and never throws; `unknown` still attempts
  (a broken probe must not silently disable deploys — P0); reattach re-queues
  page 0 once; a gated-OFF engine spawns nothing at all. CaptainPad's deploy
  strip gained a `kind: 'error' | 'offline'` union so running without the
  controller reads neutral instead of red — which is what keeps red meaningful.
  Teardown hygiene per step 10: `engine.js`'s **discarded** `fs.watch` handle is
  kept and `close()`d in `shutdown()`, and `dispose()` kills/unrefs any
  in-flight CLI child, shrinking the live-handle set that is the only window the
  libuv `async.c:94` assert is reachable in. Stated plainly: that is **hygiene,
  not a proven abort fix** — the race stays unpinned; what IS gone is the
  doomed-deploy churn that maximised its exposure. **Proof:** 23 new tests — 7
  template-budget (the core invariant being that on-disk, forced-LF and
  forced-CRLF bytes must compile **byte-identically**, plus a printed headroom
  report that flags encoder INIT at **5 chars** of margin) and 16
  attach/survival (child hard-abort `0xC0000409` mid-drain carrying the real
  `UV_HANDLE_CLOSING` text, 6 KB stderr, spawn `error` event, synchronous spawn
  throw, device vanishing between debounce and drain, ten detached edits → ONE
  line, probe exit-code mapping, `dispose()` behaviour — each with an
  `unhandledRejection` trap asserted empty and the hook proven still usable
  afterwards). Engine `npm test` **2324 → 2347 tests, 8 → 8 failures: the SAME
  eight**, verified not-mine three ways (7 env assertion fails live in 3 files
  this change never touches; the 8th is a Node test-runner IPC artifact that
  reproduces with my new test files REMOVED, passes 47/47 × 3 in isolation, and
  vanishes under `--test-concurrency=1` at **465/465**). CaptainPad **889 pass**
  + `tsc` clean. Real-child end-to-end with the VSN1 unplugged: **1 log line, 4
  cheap probe children, 0 deploy-CLI spawns** — where the old code would have
  burned four ~2–3 s compiles, failed four times and painted four red banners.
  One deliberate deviation: the pure compiler was split into
  `tools/vsn1_config/lua_action_string.cjs` so the engine's test runner never
  loads the native `serialport` addon; `grid_serial.cjs` re-exports all four
  symbols, so every existing caller is unaffected. **Open for Sina: (1)** run
  `git add --renormalize .` — the 9 templates are still CRLF in the working tree
  (harmless now, but that command is what stops the drift); **(2)** sign off
  `_30` step 11 (bounded launcher auto-restart on abort-class engine exits) —
  `launcher.js` is untouched and nothing depends on it, but it is the one
  guarantee `_31` does not provide: an unpinned teardown race can still end the
  night.
- 2026-07-28 — **VSN1 deploy-overflow + libuv-abort DIAGNOSED (`_30`, Fable)
  — both root causes on file, fix plan ready for Opus (`_31`).** The
  5960-vs-909 overflow is a **CRLF bug, not content**: `grid_serial.cjs
  stripLineComments` (:606) can't match comments on `\r`-terminated lines
  (`.` stops at `\r`, `$` has no `/m`), and the working-tree `.lua` templates
  are CRLF (`core.autocrlf=true`, no `.gitattributes`, index stores LF) —
  the July-15 dump proves the SAME templates + SAME grid-protocol version
  compiled encoder INIT to 904/909 with LF. Reproduced offline exactly
  (5960, layout-independent, thrown pre-serial at the FIRST compiled
  element); under CRLF 6 of 9 templates overflow, and a surviving `--`
  comment would comment out the entire flashed script while passing
  checkSyntax (the overflow error is what saved the device). The libuv
  abort is **NOT the deploy child** (21/21 clean exits incl. the byte-exact
  engine invocation against a fake engine on an ephemeral port) and **not
  mechanically linked** to the overflow (engine survived the identical
  failure live on 07-25; all engine-side rejections are caught) — it's a
  process-teardown race (engine-exit with live handles / launcher
  execFileSync family; engine+launcher have zero native addons, so the
  assert is only reachable during handle teardown), riding the constant
  doomed-deploy churn (deploy-on-boot fires it 1.2 s into EVERY boot).
  Attach detection today: NONE — the engine deploys blind; detached would
  mean per-change spam once templates are fixed. Plan: 12 numbered steps in
  `.agent/reports/202607/20260725_30_vsn1_midi_attach_debug.md` (CRLF fix +
  comment-survival guard + `.gitattributes` + 3-ending budget test with
  headroom report, probe-child attached/detached state — one loud line per
  transition, neutral CaptainPad badge, Codex-P0-clean — engine-survival
  tests incl. child-abort mid-drain + device-vanishing, teardown hygiene,
  bounded launcher auto-restart on abort-class engine exits). **Sina: 4
  questions in `_30` §7** (which process printed the assert — `[engine]`
  prefix or bare; does :6968 answer post-crash; launcher or bare engine;
  approve the supervision change).
- 2026-07-28 — **Curator role created + Codex agent onboarded** — the
  operator now runs a second agent lineage (OpenAI Codex) as content
  CURATOR: patterns, effects, transitions, blends, playlists. Role brief
  with scope walls + engine rights: `.agent/roles/curator.md` (pointers
  added in AGENTS.md and `.agent/README.md`). Claude side keeps engine/
  CaptainPad/sim/infra/model plumbing and all `.agent/` tracking; curator
  writes only patterns/, effects/, scenes/*/playlists/, and its two test
  dirs, logs to ~/tmp/codex_patterns_log.md. Curator may drive/restart
  the ONE existing engine, never a second one. Curator's kickoff review
  surfaced a Claude-side feature list (Titanic model output mapping is
  empty: 981 px, zero patches/controllers/sections/viewmasks; playlist
  contract drift already found — stale `01_cylon_sweep` keys); those
  items are being sequenced as the Titanic-scene enablement workstream.
- 2026-07-28 — **Local-only scheduling track opened** — dated deadline
  planning for the features-to-deploy list now lives in gitignored
  `.agent/reports_local/` (operator rule: no future dates in tracked files;
  the repo is public). First status file written there covering today.
  Rationale + rules: `.agent/reports_local/README.md` on the operator's
  machine.
- 2026-07-28 — **VSN1 MIDI attach/detach debug OPENED (`_30`, Fable → Opus
  fix as `_31`)** — operator hit, on an effect change in the UI: "VSN1 layout
  NOT deployed: Action string is 5960 chars; device limit is 909 (grid
  CONFIG_LENGTH)" followed by the libuv abort `!(handle->flags &
  UV_HANDLE_CLOSING)` (async.c:94) killing the engine — same pair as the
  `_27` side observation. Mission: MIDI attached/detached as a first-class
  engine state (detached = one loud skip line, no deploy attempt, no crash,
  hot plug/unplug safe), root-cause both messages and whether they're linked.
- 2026-07-28 — **R7 gamma UI + fleet push LANDED (`_29`)** — gamma is now an
  operator control, not an agent CLI errand. Every LED controller card in the
  sim's Controllers panel carries editable r/g/b/w gamma fields (the scene
  mirror, so the preview follows the moment you type) plus **⬆ Push gamma**;
  the LED group header carries **⬆ Push gamma to all**, which runs the fleet
  SEQUENTIALLY and prints one row per controller — ok / failed / unreachable /
  skipped, unreachable units named, never a rolled-up "mostly worked". Every
  push runs the same discipline the CLI tool did (full-config backup to
  `~/tmp/led_controller_configs_backup/` → gamma-ONLY partial write →
  read-back verify) and only then writes the HARDWARE-VERIFIED numbers into
  the scene mirror + a `device.lastGammaPush` stamp; a failed push leaves the
  mirror untouched and says which controller failed. One implementation
  (`simulation/server/led_gamma_service.cjs`) is shared by the save-server
  route and the CLI, so they can't drift. Browser never talks to a controller
  directly. **Live-proved** on the bench controller: g 2.2→2.3 pushed
  (`outcome: applied`, no reboot), read-back verified, restored to 2.2
  exactly; invalid curve → 400 at the field, offline unit → named unreachable.
  Sim suite 591/591 (20 new). NOTE for the operator: the save-server must be
  restarted (`npm start`) to serve the new route — browser code is served from
  source, server code is not.
- 2026-07-28 — **R7 gamma went LIVE on the bench controller** (coordinator
  ran the blocked `_25` steps): per-channel gamma r/g/b 2.2 / w 1.0 pushed
  via `led_gamma_push.cjs` to the test-bench LED controller — applied
  without reboot, hardware read-back verified, full pre-change config
  backed up (`~/tmp/led_controller_configs_backup/`), scene mirror
  (`controllers.yaml` `controllerGamma`) updated to match. Fleet scan
  found exactly ONE controller online; others get the same push as they
  appear. The `_25` deploy also ran (before the no-deploy order existed).
- 2026-07-28 — **Controller web-UI gamma question answered (read-only
  probe):** the bench controller's app build DOES support gamma (our push
  persisted; capability advertised) — but the device's built-in web page
  is an older bundled UI that predates the gamma card, so `/#config`
  will never show it without a rebuild-and-reflash of the device's web
  assets (USB-only → falls under the firmware pause). Not a blocker:
  the HTTP config path + the sim's new gamma UI (in flight, `_29`) are
  the supported way to set gamma. Detail in the ~/tmp review addendum.
- 2026-07-28 — **White-headroom investigation CLOSED-PAUSED by operator
  verdict** ("RGBWAU→LED is okay now... colored patterns look good, pause
  the white issue"). Findings preserved in ~/tmp: static-white mechanism
  = composite headroom ceiling (patterns author 1.43-1.7× multi-emitter
  stacks; the strand's single 255 composite pins the top range; kick pops
  additionally erased by the controller's white processing); bit depth,
  W-gamma exonerated. Ready-to-go when resumed: P1 soft-knee compressor,
  tint-preserving `headroom` knob (~0.6), the LED-0-track→0.40 hand test,
  and the paused firmware option (~510 white levels, 1.7-2.5× lumens).
  Operator's proposed (W+A)/2 conversion evaluated and declined with
  numbers (≈90 % of its gain is just halving white; severe warm-tint
  cost) — his underlying idea survives as the tint-preserving headroom
  knob. Also reconciled: his null dimmer test used a track that either
  doesn't feed the strand or left kick peaks over the ceiling — the
  theory stands; the 0.40 test on the strand's own group track (sId 5)
  is the definitive hand check.
- 2026-07-28 — **R7 gamma UI + fleet push wave launched (`_29`, Opus, in
  flight):** per-controller gamma editors in the sim's controllers UI,
  scene-mirror auto-sync on verified pushes (hardware and preview can
  never silently diverge), per-controller + push-to-ALL actions with
  named per-unit results (ok/failed/unreachable — no silent partial
  fleet), full-config backup before every write. Live-proves against
  the bench controller and restores its values exactly.
- 2026-07-28 — **Pattern count clarified for the record:** 68 pattern
  files total; 40 call `rgbwau()` (all swept by `_26`); 28 are rgb/hsv-
  only and never emit W/A. Caveat noted: rgb-only patterns can still
  produce RGB-mix "white moments" that will read cooler than the w==a
  warm standard — inventory offered, operator hasn't ordered it.
- 2026-07-28 — **R6 Studio-tab TEXT EDITOR debugged (`_27`, Fable) —
  root causes proven, PATCH plan ready for an Opus fixer.** Operator:
  "cursor is broken — cannot go to a position to type or anything",
  bad on iPad AND desktop. Architecture: transparent controlled
  `TextInput` overlaid on a tokenized syntax-highlight `<Text>` inside
  the EDIT modal (`CaptainPad/app/(tabs)/studio.tsx:228-279`) — sound
  pattern, four broken details, all measured on a fresh `:7167` dist
  (operator's :6967 Metro untouched): (D1) caret INVISIBLE — RNW 0.21
  silently drops `selectionColor` on web, so caret-color inherits the
  input's transparent text colour; (D2) the textarea's internal
  scrollbar steals ~15px of wrap width vs the highlight → soft-wrap
  divergence (+6 rows @1280x800, **+41 rows @820x1180** on the 17KB
  `00_golden_hour_wash`) → taps land lines away from the glyph
  clicked; (D3) caret near EOF scrolls the invisible textarea
  internally (`scrollTop 120`) while the highlight stays → the whole
  editor permanently offset until reopened; (D4) 53-88ms per
  keystroke measured (whole-file retokenize, rendered twice) — est.
  150-350ms on iPad Safari; (D5) `KeyboardAvoidingView` is a no-op in
  react-native-web so the iPad keyboard covers the editor; no
  caret-follow (D6); Tab exits the field (D8). Explicitly verified
  NOT broken: caret preservation through the controlled cycle, native
  undo, copy/paste, the save/RUN path, and there are NO live engine
  subscriptions re-rendering the pane. Verdict: **patch, not
  rebuild** (the overlay is the proven react-simple-code-editor
  pattern; a vendored CodeMirror is unjustified pre-playa). `_27`
  carries the verbatim 7-step plan (A1 caretColor, A2 geometry lock
  via `overflow:hidden` + byte-identical text metrics, A3 per-line
  memoized highlight + skip covered preview, A4 visualViewport
  keyboard handling, A5 mirror-based caret-follow, A6 Tab handler, A7
  tap-preview-to-edit) + do-not-touch list + 3-viewport validation
  recipe. Unrelated observation: the local test engine crashed while
  idle on the known VSN1 page-0 deploy overflow (5960 > 909 chars) +
  libuv assertion — existing feat/bm_readiness thread, not Studio.
- 2026-07-28 — **R6 Studio-tab TEXT EDITOR FIXED (`_28`, Opus) — the
  operator's "cursor is broken" is closed.** All 7 steps of `_27`'s plan
  applied to `CaptainPad/app/(tabs)/studio.tsx` plus two NEW shared files
  (`components/code_highlight.tsx`, `components/studio_editor_logic.ts`
  + 17 vitest cases); the do-not-touch list (save pipeline, in-flight
  guard, cold-start await, modal structure) honoured, no new deps.
  Re-proved live at **1280x800 / 820x1180 / 1180x820** on a fresh
  `expo export` dist on **:7167** (operator's :6967 Metro untouched):
  caret paints `rgb(0,218,243)`; `offsetWidth == clientWidth` and
  `|scrollHeight − highlightHeight| = 0 px` at every viewport, so
  **tap-to-position lands on the exact character** — 0 off at mid-file,
  at the deep `rgbwau(` token, and at EOF *after* the deep-scroll trip
  that used to break the editor permanently (`ta.scrollTop` stays 0);
  Tab inserts 2 spaces with the native undo stack intact; the outer
  scroller follows the caret; the modal tracks `visualViewport.height`
  so the header stays above the keyboard; tapping the preview opens the
  editor. Keystroke median **88.4 → 24.8 ms** (74.6 → 23.9, 53.3 →
  24.5) — the <16 ms target is NOT met and the residual is Chrome's
  layout of the 8.8k-px block, not tokenizing; `useDeferredValue` is
  the documented next lever. **Two defects `_27` could not see** turned
  up by asserting the invariants instead of trusting the source: the
  pattern files are **CRLF** and a textarea's `.value` strips CR, so
  the highlight layer carried 312 extra `\r` (17,564 vs 17,252 chars)
  and taps stayed **−304 characters** off; and a textarea paints an
  empty final row for a trailing newline that a pre-wrap block does not
  (one row of residual internal scroll). Both closed without changing
  the bytes SAVE writes. Not deployed (standing order; Metro
  hot-reloads to his iPad) and RUN/SAVE deliberately never pressed —
  the only engine on the net is his live :6968. Still needs the
  physical iPad: D9 iOS smart punctuation (system-level, unemulatable),
  touch magnifier caret drag, real keyboard geometry, felt Safari
  latency, one SAVE roundtrip. tsc clean, vitest **886**.
- 2026-07-28 — **R2/R7 WHITE=AMBER lane-matching pass LANDED + DEPLOYED
  (`_26`).** Operator finding on the DMX pars: `rgbwau(0,0,0,1,0,0)` (W only)
  renders **too cold**, `rgbwau(0,0,0,0,1,0)` (A only) renders **almost
  yellow**, and `rgbwau(0,0,0,1,1,0)` (**W and A matched**) is the ship's good
  warm white — which is also what the LED strands render, since the `_25`
  strand path folds amber back into RGB. Convention adopted: **wherever a
  pattern emits white, W and A carry the same exact value**; pure-W or pure-A
  whites are authoring bugs. Swept **all 40 `rgbwau()` patterns** in
  `marsin_engine/patterns/` (39 edited, `65_uv_only` already compliant),
  including the uncommitted DRAFT white family 60–65. Animation logic
  untouched — this was a lane-matching pass only, applied two ways: duplicate
  the white expression at the call site (23 patterns whose amber was a literal
  `0.0`), or assign `amber = white` immediately before the emit (11 patterns
  that computed their own amber lane) / `aLane = wLane` (the 60–64 white
  family, which previously scaled amber by `warmAmt`; warmth still shapes the
  RGB lanes). Convention documented in `docs/MARSIN_ENGINE_PATTERNS.md` §5.1
  "White handling: the `w == a` convention" (why, the reference snippet, the
  authoring idiom, and the rule that amber is **not** a standalone colour
  accent); the doc's own §6.1 example that emitted `w, w*0.4` was corrected.
  Enforced by a new auto-discovering test
  `marsin_engine/tests/patterns/white_amber_lane_match.test.js` — it finds
  every pattern calling `rgbwau()`, renders it on `test_bench` and asserts the
  W and A **bytes** are identical on every pixel of every frame, so the next
  pattern that forgets fails in CI instead of on the playa (no allowlist, no
  opt-out). Verification: lane test **41/41 green**; full pattern suite
  **88/88 green** (incl. the pre-existing `specialty_white_uv` contracts, so
  60–65's neutral-RGB / driven-W promises still hold); **all 68 patterns
  compile**; dry-run load smoke green for 60–65 + representatives. (A later
  pattern-suite re-run read 87/88: the operator's **live local engine** captured
  `61_white_breathe` slider defaults into
  `simulation/scenes/test_bench/playlists/white_wednesday.yaml` at 21:37, so it
  no longer matches the `titanic` copy byte-for-byte. Live-engine residue in a
  tracked file — reported, not reverted, not committed; unrelated to the pattern
  edits. Lane test still 41/41 at that moment.) Full engine
  suite 2307/2324 — the 17 failures are all environmental and none are
  pattern-side (5 ffmpeg audio-capture, 1 node test-runner IPC flake, 1
  Windows `EACCES` port bind, and 10 playlist/state API tests failing `409
  PERFORMANCE_MODE` because the operator's live engine holds performance mode).
  Deploy preflight found **zero remote-newer files** under
  `simulation/scenes/test_bench` + `marsin_engine/models`;
  `deploy.py deploy --machine titanic-ext --scene test_bench` → **DEPLOY OK**
  (engine `activeModel=test_bench`, sim up, supervisor `restart_count` stable
  at 0). ⚠️ **That deploy ran BEFORE the operator's stand-down order** ("do not
  deploy to the remote — moving development onto the local machine, will deploy
  himself later"), which arrived afterwards; **no deploy has run since, and no
  agent deploys to `titanic-ext` until Sina says so.** Net effect: the remote is
  one deploy ahead and consistent with local, nothing remote-edited was
  overwritten — revertible on request. **Seven patterns are flagged for the operator's eyes at R2 re-tune** —
  these had amber doing real work beyond "warm tint under white", so the rule
  visibly changed them: `17_rolling_color_dunes` and `13_sparkle` (strongest),
  `00_golden_hour_wash`, `07_shimmer`, `11_bioluminescence`,
  `04_beat_folded_helix`, `05_orbital_attractor_field`. Systemic alternative
  noted for later: a single choke point in the mapper/host could enforce
  `a = w` for the whole codebase in one place, but it would silently overwrite
  pattern intent, so the per-pattern pass + the test guard was kept.
  Transition and channel-blend scripts deliberately out of scope (they
  composite existing pixels rather than author white). Report: `_26`.

- 2026-07-28 — **R7 software colour wave `_25` LANDED (code + tests), deploy
  and gamma push BOTH permission-blocked.** Strand emission is now clip-proof
  TRUE RGBW: amber folded into strand RGB (UV stays dropped — no emitter), the
  whole RGBW quad jointly pre-scaled by one factor so the LED controller's
  white processing can never clip, composite quantized first so `RGB + W ≤ 255`
  holds exactly. Proof (old vs new, real modules): a tungsten warm white used
  to arrive **neutral 255,255,255** and now arrives **255,205,133** (tint
  `1 : 0.80 : 0.52`, matching intent); amber-only content used to be **black on
  strands** and now glows; **saturated colour is bit-identical** — the good
  colour look is untouched, and the before/after sim renders are visually
  identical for a saturated pattern (that IS the pass). Tint holds to 0.2 % at
  full and 1.1 % at 5 % master; below ~3 % master 8-bit quantization caps it at
  ±4 % (physics, documented, bounded by test). Sim preview now derives strand
  colour from the exact wire bytes + modeled controller behaviour on both the
  out-map and the sACN-in demap, so screen = strand; the controller model sits
  behind ONE function keyed by a per-controller config value. **Gamma lives in
  exactly one place: the LED controller** — the mapper emits linear bytes and
  rejects a mapper-side gamma key loudly. New operator tool
  `simulation/agent_tools/led_gamma_push.cjs` (full-config backup → partial
  write → read-back verify → prints the scene mirror line → documented revert);
  recommended curve r/g/b 2.2 **w 1.0** — W must NOT get its own exponent
  because the controller derives white after its RGB curve and the two compound
  (the review's 1.8 would put whites on an effective ~4.0 curve). Suites: sim
  **571/571** (baseline 542, +29 new, zero regressions), engine LED-parity
  **24/24** (old-policy assertions rewritten to the new contract), engine full
  suite 8 fails = the known env set. **Blocked, needs the operator:** (a) the
  gamma push itself (one command, hardware still at gamma off, scene mirror
  matches so nothing is lying), (b) `deploy.py` (denied) — remote-newer
  preflight PASSED, but note the laptop's test_bench model carries 20 px/strand
  vs 40 in HEAD/remote (pre-dates this session, looks intentional, a deploy
  ships it). Report `_25`; wire math + runbook in the ~/tmp addendum.
- 2026-07-28 — **R7 (LED tuning & mapping) added** on operator order.
  Color/white review done (deliverable in ~/tmp only, per the
  public-repo privacy rule); software fix wave `_25` in flight
  (clip-proof RGBW emission + amber fold + controller config gamma +
  honest preview); controller-side pass-through change assessed
  (moderate payoff, USB-per-unit burden) — test-bench-unit A/B
  before any fleet decision; per-output scoping question answered.
- 2026-07-27 — Dossier created. R1 audit agent launched (Opus, report
  `20260725_10`). R6 plan agent in flight (`20260725_9`). R4a/R4b tracked,
  blocked on hardware/assembly.
- 2026-07-27 — R6 plan landed (`_9`); R1 audit landed (`_10`) — show
  director exists (timeline), detector loudness-only + stuck-party
  reproduced live. Both BUILD waves launched on Opus: R6 UI wave
  (`_11` reserved) + R1 detection build (`_12` reserved).
- 2026-07-27 — **R1 BUILT + DEPLOYED** (`_12`): detector, staleness
  guard, timeline plan, draft trio playlists live on titanic-ext.
  Deploy verification caught the hand-maintained OSC emit-list bug
  (new keys never reached the engine — party could never have
  fired); fixed + drift guard.
- 2026-07-27 — **R6 rounds 1+2 shipped** (`_11`): all 6 plan items +
  round-2 fixes (master fader was off-screen pre-wave; 1-row
  landscape title bar; perf −30 %; lock toast). Deck weights ended
  back at original 40/30/30 after live A/B. R2-4 awaits operator
  answer. iPad-res screenshot sets delivered.
- 2026-07-27 — **R2 specialty wave PARKED** mid-report on operator
  order (pattern work needs him present). Residue on disk: patterns
  60–65, themed playlist YAMLs, tests — unvalidated, undeployed.
- 2026-07-27 — Pattern-switch lag/dim regression reported from iPad
  (rows feel weird TX-off, names render dim). Operator pipeline:
  Fable debug (`_14`, in flight) → Opus fix (`_15`) → Opus validate
  (`_16`). Server freedom granted: titanic-ext free to stop/deploy.
- 2026-07-27 — Master-doc RULE added at top on operator order; doc
  brought current.
- 2026-07-27 — **Swap-wedge FIXED + DEPLOYED** (`_15`): engine now
  fires `onDeckSwapCancelled` → broadcasts `deckSwapComplete
  {cancelled:true}` (reused type, no client change needed), plus a
  CaptainPad `durationMs + 2 s` watchdog for WS blips. Wedge heals in
  17 ms with both, 5.3 s with the watchdog alone (proved by isolating
  each fix); post-panic taps POST again. Engine 2205 pass / 7 known
  env fails, tsc clean, vitest 803, states residue restored.
  titanic-ext `DEPLOY OK` — but note the deploy `robocopy /MIR`s the
  whole dirty tree, so the PARKED R2 pattern residue went out with
  it. Validate next (`_16`).
- 2026-07-27 — **Swap-wedge VALIDATED — PASS, no defect** (`_16`,
  adversarial). Live non-PANIC cancels (snapshot morph kickoff, deck
  remove/replace) heal in 2-4 ms; a REAL TCP socket sever mid-fade
  (19 sockets destroyed, reconnects refused) is healed by the
  watchdog at 8 060 ms vs its 8 000 ms window, list usable on
  reconnect; 12 rounds of swap-over-swap + `Promise.all` PANIC/select
  races produced **zero stale-unlock** (engine 409s swap-over-swap and
  broadcasts cancels synchronously, so a cancelled-complete can never
  overtake a later started). Regression clean: S1 22.8-47.2 ms, by-design
  mid-fade dim intact, tsc clean, vitest 803. Engine suite is **8 fails,
  all known-env** — `_15`'s "7" undercounted a pre-existing flaky
  worker-IPC fail (`timeline_deck_release_default_cue`, tracked since
  Jul 11, no mixer/api imports, fails in isolation). **titanic-ext
  healthy**: restart_count 0, renderHealth ok, sim 200, all 68 patterns
  (incl. parked R2 60-65) + 14 playlists load with no errors or loops —
  **the parked residue causes no live problem** — and the wedge fix
  reproduces + heals in 8 ms against the remote engine; remote restored
  (transition-config, master 0.9213, deck pattern). Two non-blocking
  notes: client clears the lock on ANY `deckSwapComplete` (no
  `transitionId` match — safe today, worth hardening), and a
  **pre-existing** 88 MB titanic-ext log from unthrottled
  `sACN Out Send error EHOSTUNREACH` spam (disk-fill risk on playa,
  unrelated to this fix — backlog card).
- 2026-07-27 — **Both `_16` notes CLOSED + DEPLOYED** (`_17`, hardening
  mini-wave). (a) **sACN/Art-Net send-error logging is now throttled
  per destination** (`lib/send_error_throttle.js`): first error logs
  immediately, a change of error class logs immediately, then one
  summary line per destination per 30 s carrying the outage duration +
  suppressed count, and one RECOVERY line on the first success.
  Throttled, never silenced — live proof: 65 s against an unroutable
  host at 40 fps × 2 universes = **5 240 failed sends → 6 log lines**
  (was 5 240). That turns the 88 MB/4 h disk-fill risk into ~KB/day.
  (b) **CaptainPad now matches `transitionId`** before releasing the
  deck-swap lock (`deckSwapCompleteReleasesLock`), so a stale complete
  for a superseded swap can no longer unlock a live one — with both
  heal paths preserved (client that missed `deckSwapStarted`, or a
  complete carrying no id) and the watchdog still the backstop. Engine
  2 217 pass / 7 fails (all known-env; the flaky worker-IPC one did not
  reproduce this run), 9 new throttle tests green; tsc clean, vitest
  **809** (803 + 6 new); states residue-clean. titanic-ext `DEPLOY OK`.
- 2026-07-27 — **CaptainPad surface trim + party HANDLING card** (`_18`).
  (a) The **Monitor tab is gone** — screen, route, sidebar entry and its
  now-dead `desktopcomputer` icon mapping; nothing else imported it
  (`react-native-webview` is now unused by app code but stays in
  `package.json` — removing a dep needs an `npm install` and the playa
  rule is no runtime installs). (b) The **Audio tab** gained an **OPEN
  COMPANION** button and keeps ONLY that: the URL is derived from the
  effective api_base (Config-tab AsyncStorage override included) with the
  port swapped to the companion's 6966 (`launcher.js` COMPANIONS.audio),
  so Sina's iPad resolves `http://10.x.x.151:6966`, never 127.0.0.1; an
  unparseable base throws and the card says so instead of guessing.
  (c) Per the operator's division of concerns, **PARTY MODE handling now
  lives on the TIMELINE tab**: hard enable/disable, trigger-playlist
  picker, and steppers for sustain-before-trigger (m:ss), session length
  (min) and cooldown (min), plus an armed / disabled / no-plan /
  in-session / cooldown status line that prefers the engine's
  `effectiveState` and otherwise derives from `/timeline/state`. Client is
  `CaptainPad/utils/party_api.ts` against `GET/PUT /party-config`; every
  edit reconciles to the PUT response and a 400 prints VERBATIM (no silent
  revert). tsc clean, vitest **842** (809 + 33 new). **No deploy**:
  titanic-ext runs `profile: prod` (sim + engine only) and `dist/` is
  gitignored — CaptainPad is Metro-served from Sina's laptop, so the
  changes hot-reload to his iPad. The engine's `/party-config` route is
  **not up yet** (404 on titanic-ext at the time of writing), so the card
  renders its fail-loud error state; live proof still owed.
- 2026-07-27 — **PARTY MODE card: session-length modes + cooldown gating**
  (`_18` addendum, two operator revisions). The Timeline card now has an
  always-on SUSTAIN stepper (the strong-detection guarantee, no toggle) and
  two SESSION LENGTH modes: **ON** = fixed `durationMin`; **OFF** =
  follow-the-music, which ends when the party signal drops. There is **no
  timeline-side release value** — the release IS the companion's
  `offConfirmMs` (one sustain, not two stacked), so that row is a hint whose
  "Audio Companion" text deep-opens the companion via the same URL helper the
  Audio tab uses. **COOLDOWN is forced off, greyed and stepper-less whenever
  duration is off** ("no cooldown in follow-the-music mode"); the rule lives
  in one pure `describePartyRows()` applied to the engine's own fields, so the
  card can't show a state the engine doesn't hold. `cooldownSec` default is
  now 120 s. Playa-proofing per the operator: every control queues into ONE
  coalesced patch committed on a 700 ms debounce (**6 mashed toggle taps →
  exactly 1 PUT** carrying the final intent, verified live), an engine that
  drops mid-edit **keeps** the pending edits behind a RETRY instead of losing
  them, and missing contract fields are rejected by name (no guessing).
  `party_api.ts` 35 vitest cases; tsc clean, vitest **852** (809 + 43 new).
- 2026-07-27 — **Companion PARTY tab + engine party authority** (`_19`,
  DEPLOY OK on titanic-ext). Report 20260725_12 §6's curl-loop tuning
  procedure is now a UI: `marsin_engine/audio/companion/ui` gains a **PARTY**
  tab with live meters for every term of the gate (loudness against the
  `ambientFloor × marginX` marker, kick rate inside a shaded accept window,
  kickReg / low+high share against their lines, BPM-lock and silence pills,
  the four term verdicts → QUALIFY, and a debounce progress bar reading
  "qualifying 4.2s / 20.0s"), editors for all 11 `party:` tunables with
  **APPLY** (runtime, fail-loud) and **PERSIST** — a *surgical* line edit of
  config.yaml's `party:` block, because a yaml round-trip strips every comment
  (it destroyed the palettes comments once); a key line that can't be located
  exactly writes NOTHING and errors. Plus the §6.2 **capture helpers**
  (ambient P95 / party P5 → suggested `ambientFloor`/`marginX`/`kickRegMin`,
  one click to load into the editors, never auto-applied), a runtime-only
  **validation mode** (`onSustainMs` → 3 s, never persisted), and a
  runtime-only **FAKE TRIGGER** (AUTO / FORCE PARTY / FORCE OFF at the publish
  stage — verified live: forcing moved the engine's `audioPartyStrong` to 1
  while the detector's own truth stayed 0 in the meters).
  Engine side gains **`GET/PUT /party-config`** — the single authority for
  `enabled` (hard override: the mood cue cannot fire, and a live session ends
  at once), `playlist`, `minDwellSec` / `durationMin` / `cooldownSec` (default
  now **120 s**), `durationEnabled` / `cooldownEnabled`, plus derived
  `effectiveState` (armed | disabled | no_plan | manual | in_session |
  cooldown) and effective values. Persisted in `timeline_state.yaml` (survives
  a supervisor restart), seeded ONCE from the plan so adopting it repoints
  nothing, read at FIRE/EVALUATION time so an edit needs no plan reload, and
  broadcast as `partyConfig` on `/ws/control` + replayed on connect.
  **Follow-the-music mode** (`durationEnabled:false`): no fixed length, no
  cooldown, ends when the party signal drops — which already carries the
  detector's `offConfirmMs`, so there is exactly ONE release sustain and it
  lives in the companion. Timeline compatibility is the point: party is a
  citizen, not a bypass — human takeover beats it, a dormant/absent plan means
  no dwell at all, a stale mood ends an open-ended session. 45 new tests
  (15 companion + 30 party×timeline); engine suite 2265 / 7 known env fails.
- 2026-07-27 — **PARTY MODE card: landed contract consumed + LIVE proof**
  (`_18` addendum 2). The engine's `/party-config` went live on titanic-ext,
  so the Timeline card now consumes it as the authority: six-value
  `effectiveState` with **MANUAL** shown distinctly ("the operator has the
  deck", never folded into NO PLAN) and `no_plan` + `inFestivalWindow:false`
  rendering **OUT OF WINDOW** with the reason; live **"ends in m:ss"**
  countdown from `sessionEndsAtMs` (or "follows the music" when
  `sessionFollowsMusic`), **"cooling down m:ss"** from
  `cooldownRemainingSec`; cooldown greying driven by
  `effectiveCooldownEnabled`, with `effectiveDurationMin` /
  `effectiveCooldownSec` surfaced as an "engine uses N" note when they differ
  from the configured value. While in_session/cooldown the card ticks 1 Hz and
  re-reads the engine every 5 s (no drifting client timer). All additions
  parse as OPTIONAL but are type-checked by name when present, so a
  pre-addition engine still works. **LIVE proof (404 IOU closed):** real GET
  renders 14 playlists + OUT OF WINDOW; a COOLDOWN stepper tap round-tripped
  `{"cooldownSec":180}` through the real engine and back to 120 (plus a direct
  120→121→120); toggling duration OFF made the engine report
  `effectiveCooldownEnabled:false` and the card greyed the row from that.
  titanic-ext verified restored to its exact starting values. Changes were
  display-only/additive so the parallel adversarial validator's target didn't
  move. tsc clean, vitest **867** (809 + 58 new; party_api 50 cases).
- 2026-07-27 — **ADVERSARIAL VALIDATION of party × timeline — CONDITIONAL
  FAIL** (`_20`, Opus, brief: "break it, don't bless it"). 48 in-process
  probes against the real `TimelineService` (38 pass), 40/40 hostile-HTTP,
  5/5 WS, plus a full live chain and a live CaptainPad run. **SOLID:**
  party-vs-scheduled-cue precedence 7/7 (a clock cue landing mid-session takes
  the deck cleanly, no A/B flapping over 30 ticks, a held program suppresses
  the party fire into `wouldFire`, a same-tick collision settles
  deterministically); flapping + edge storms 11/11 (20× enable/disable during
  dwell/session/cooldown never consumes a fire, re-stamps a cooldown or
  orphans a latch; `durationEnabled` flipped 20× mid-session keeps the started
  mode both ways; 119 s vs 121 s dwell boundary exact; 100 one-second mood
  flaps produce zero fires and zero errors); hostile input 40/40 (every bad
  type/bound/unknown field/playlist, `__proto__`/`constructor` injection,
  1e400, duplicate keys, non-object bodies → 400 with nothing applied; 25
  concurrent conflicting PUTs land on exactly ONE submitted state); WS replay
  + broadcast + topic routing 5/5; restart safety 6/7 (no resurrection,
  cooldown stamp survives, persisted policy honoured, defaultCue reclaims);
  and live end-to-end: follow-the-music releases ~3 s after FORCE OFF with NO
  cooldown and re-triggers on the dwell alone, a stale mood mid-session forces
  CALM and ends the open-ended session, forced+disabled does nothing.
  **BLOCKING DEFECTS (all in PRE-EXISTING code, none in `_19`'s):**
  **D1** the mood cue re-arms ONLY on a drop to CALM, so a fixed-duration
  session fires **once per continuous music episode** — at a real party the
  rig runs ambient the rest of the night while `effectiveState` reports
  `armed`; **D2** an engine restart mid-party inherits that latch from
  persisted state, so party never returns that night (the "restart-safe in
  every mode" requirement fails in exactly the supervisor-restart case);
  **D3** the cooldown is stamped at the FIRE, not the session end — with the
  shipped 12 min / 120 s the entire cooldown burns inside the first 2 minutes
  of the session, so there is effectively no cooldown and
  `effectiveState: 'cooldown'` is unreachable (CaptainPad's "Session just
  ended — waiting out the cooldown" can never render honestly); **D4** an
  operator takeover mid-session **resurrects** the session on lease release
  with a fresh full `durationMin` and re-applies the party look even with the
  mood at CALM (`_catchUp`'s resume re-apply is not mood- or policy-aware) —
  same cause as **D5** (a mid-session `savePlan` restarts the window),
  **D7** (an ambient flash on a mid-open-ended-session save) and **D8** (an
  orphaned ownership latch when the party cue is removed mid-session);
  **D6** CaptainPad's PARTY card never learns of a transition it isn't
  already tracking — proven live showing ARMED for 24 s while the engine was
  `in_session`, and an ENABLED toggle over a DISABLED pill. Plus nits: an
  empty PUT body returns 200 (D10) and a corrupt persisted party field throws
  once per tick unthrottled while silently killing the WHOLE timeline (D11).
  **Suites clean:** engine 2267/2260/7 with ZERO delta from the known
  environmental 7, 69/69 on the party+timeline files in isolation, zero
  states residue from the suite, CaptainPad tsc clean + vitest 867/6 skipped,
  and the `_16`/`_17` swap-wedge guarantees still green (9/9 + 11/11).
  **titanic-ext read-only and byte-identical to its session-start baseline;**
  the operator's :6967 Metro never touched (CaptainPad driven on a :7167
  dist); local engine + static server stopped; the temp plan created through
  the API was deleted; no `festival.startDate` edited on disk; the two tracked
  `states/test_bench/*.yaml` the local run rewrote were restored from a
  session-start backup (stated loudly, not silently). **Next: operator call on
  D1/D3 (the fix makes continuous music yield session → cooldown → session
  forever — that IS the cooldown's purpose but it changes today's behaviour),
  then build agents on D4/D5/D7/D8 and D6.**
- 2026-07-28 — **Party × Timeline defects D1-D11 FIXED, VALIDATED + DEPLOYED**
  (`20260725_22`, executing plan `_21` against validation `_20`). Operator
  semantics, now real: with a time limit sessions **REPEAT** — session
  (`durationMin`) → cooldown stamped **at the session END** → the trigger
  **re-arms** → the next session fires while the music sustains (dwell is
  carried by `moodSince`, so continuous music re-fires the instant the
  cooldown expires); follow-the-music (`durationEnabled:false`) was already
  correct and was **not disturbed**. **`triggers.js` was not touched** — the
  whole change is session-END bookkeeping in `timeline_service.js`: one new
  `_notePartySessionEnd(endMs)` called from every end path (window elapsed,
  follow-music release, operator disable, a scheduled cue taking the deck,
  dormancy, and the `_catchUp` end cases) that re-stamps `moodLastFire` at the
  end (D3) and re-arms `moodArmed` (D1). A **boot re-arm in `start()`**
  (deliberately NOT `_catchUp`, which also runs on savePlan/resume/lease
  release where a `false` latch means a genuinely live session) means an
  engine restart can never kill party for the night, while the persisted
  cooldown stamp still hands out no free session (D2). `_catchUp`'s resume
  re-apply is now party-aware: it **ends** the session when the policy is off,
  the window expired during the takeover (cooldown credited from the scheduled
  end) or the music stopped — and otherwise **rejoins the ORIGINAL window and
  shape** instead of granting a fresh `durationMin` (D4/D5); a live
  **open-ended** owner now blocks the baseline default-cue fill, killing the
  ambient flash on a mid-session save (D7); and an ownership latch pointing at
  a cue the save deleted is cleared so the plan's `defaultCue` reclaims
  immediately (D8). CaptainPad's PARTY card subscribes to the `partyConfig`
  WS broadcast and polls while MOUNTED rather than while already-live (D6).
  Nits closed: an empty `PUT /party-config` body is a 400 like every other
  meaningless body (D10), and a corrupt persisted party field now fails
  **once, at boot**, naming the file and the field — the timeline refuses to
  half-run instead of throwing 86 k times a day while looking healthy (D11).
  **Proof:** `_20`'s probe suite **49/49** (was 38/48) after six documented
  expectation updates where the probes encoded the OLD semantics (P1.5, P3.6,
  P4.8, P5.2, P7.2 + P8's `{}` case; P12 tightened; P8's "prototype pollution"
  case was also mis-written as a JS literal and now sends a real own
  `__proto__` key); p8 32/32, p8b 8/8 with no pollution, p10 5/5; **12 new
  engine tests** (`tests/timeline/party_session_repeat.test.js` + 2 in
  `party_config.test.js`); engine `npm test` **2278 / 2271 / 7 fails = exactly
  the known environmental 7**, zero new; CaptainPad tsc clean + vitest
  **869**. Live full chain walked `armed → in_session (cooldown 0 inside) →
  cooldown 25 s → in_session` twice, and the iPad card tracked every
  transition with no reload. **titanic-ext `DEPLOY OK`** (`test_bench`,
  supervisor restart_count 0, timeline booted with `bootError: null`).
  Tracked `states/test_bench/*.yaml` the local engine run rewrote were
  restored from a session-start backup (stated, not silent); only the
  gitignored `timeline_state.yaml` differs. **Flagged for the operator (not
  blocking):** `cooldownSec: 0` gives back-to-back sessions with a ~1 s
  ambient blip between them (follow-the-music is the tool for gapless party);
  a scheduled look cue that takes the deck mid-session can lose it again once
  the cooldown expires; and a `savePlan` landing while the mood happens to be
  CALM now ends the session, whereas an undisturbed fixed session still rides
  a signal drop out.
- 2026-07-28 — **REVALIDATION PASS — the party fixes are cleared (`_23`,
  adversarial, final gate).** All 11 defects stay dead; the `_20` probe suite
  re-ran **49/49** independently, and D1/D2/D3/D6 were re-driven **live**, not
  just in-process. The headline proof: 240 s of *continuously* forced party
  audio on a real engine produced **4 sessions** (`gaps 18/16/18 s` against a
  15 s cooldown) with the mood never once dipping to calm — so the re-arms came
  from the new session-END bookkeeping, not from a calm edge that would have
  re-armed even before the fix; `effectiveState: 'cooldown'` was reachable
  throughout and read `0` for every in-session sample. D2 was proved on the
  real state file (engine stopped mid-session leaving `moodArmed: false` on
  disk → `true` after restart), and a mid-session crash still hands out
  **exactly one** session afterwards while a mid-cooldown crash continues the
  remainder to the second. The fixer's own "probe these hard" list came back
  clean: the `cooldownSec: 0` ambient blip measures **exactly 1 s** (7 sessions
  in 400 s, one party write per session, no tick ever writing two looks); the
  scheduled-cue re-take is **one deterministic take at handover +
  `cooldownSec`**, byte-identical across replays, with no oscillation over
  3 600 ticks; and the widened `_establishBaselineIfActive` guard passed a
  9-case regression hunt with no "ambient never fills" shape (the orphan-latch
  shape that could cause one is unreachable — every site that nulls
  `_deckWindowCueId` also nulls `_deckWindowUntilMs`). D11 on a real engine
  emitted **exactly one** `⛔ TIMELINE DID NOT START` naming file + field, zero
  tick spam, and booted clean once restored. Cross-checks all green: 25-save
  storms mid-session move `sessionEndsAtMs` by **0** and flash no ambient in
  either mode; disable/toggle flaps and staleness never move the cooldown
  stamp; 13 consecutive cycles leave a 594-byte persisted state. Suites: engine
  `npm test` **7 fails = exactly the known environmental 7, zero delta**,
  timeline files **317/317** (the known worker-IPC flake did not reproduce),
  CaptainPad tsc clean + vitest **869**, swap-wedge 9/9 + 11/11. titanic-ext:
  the deployed `timeline_service.js` / `timeline_state.js` / `api_server.js`
  are **byte-identical MD5** to the fixed local files, `/party-config` is
  coherent, D10 returns 400 for both an empty body and `{}` — and the remote
  GET is byte-identical before and after (no restart, no deploy, no corruption
  test there). **Three new findings, none blocking:** (F1, MED) a
  `kind: ambient|look` cue with `durationMin` does **not** protect its window —
  party reclaims the deck at cooldown expiry; the shipped `playa_default` is
  immune because every protective cue is `kind: program` with `hold`, so the
  operator rule is *use `hold`, not `durationMin`, for a moment that must not
  be interrupted*; (F2, LOW) the D11 boot refusal is **console-only** —
  `/timeline/state` still returns 200 with `lastError: null`, so CaptainPad
  shows an empty timeline with no banner (pre-existing shape, backlog
  candidate); (F3, LOW) a **second** `mood→party` cue in a plan would never get
  an END stamp or re-arm, since `_partyCue()` resolves the whole subsystem to
  the first one (`playa_default` has exactly one). End state: local engine and
  the `:7167` dist server stopped, operator's `:6967` Metro never touched,
  temp plans deleted, tracked `states/test_bench/*.yaml` restored from a
  session-start backup (stated, not silent), no source edit, no git write.
