# Views Rehaul — Final Validation & Hardening Report

Date: 2026-06-19 · Branch: `dev/claude/views_rehaul` (BM26-Titanic + MarsinLED)
Status: **COMPLETE — production-ready (modulo on-hardware ESP32 link).**

This report covers the full views-rehaul arc, the two validation phases, and the
firmware bulletproofing loop (adversarial flaw-hunt → fix → cold review, to
convergence). It is the closing record for review.

---

## 1. Final verdict

- **Firmware (MarsinLED):** PRODUCTION-READY: **YES** (cold adversarial review #2).
  Every contract area CLOSED and independently reproduced through the shipping
  WASM under ASan/UBSan. Two residual **benign NITs** (below), zero BLOCKER/MAJOR.
- **BM26 (JS sim/engine/CaptainPad):** validated — engine **899/899**, sim
  **118/118**, perf golden hashes byte-identical, all **113 patterns** compile
  through the hardened WASM, hardening confirmed reached BM26's runtime.
- **One open item, environmental, flagged everywhere:** ESP32 `pio run` link is
  unverified in this container (network policy blocks the PlatformIO registry).
  **Must be confirmed on a networked build host before flashing.**

---

## 2. What shipped (the whole arc)

| Area | Result | Commits |
|---|---|---|
| Fixture-type metadata + `FIX_*` builtin (Tier-A + Tier-B) | cross-model targeting; `27_swipe` portable | MarsinLED `3b13609`, BM26 (early) |
| Named masks / unbounded MaskRegistry (`members[]`) | host-side views unbounded, bit-free | BM26 |
| MarsinScript in-VM interned strings (`==`/`!=` only) | zero hot-path cost | MarsinLED `808e8a8` |
| Perf gauge + validation harness (golden-hash oracle) | fail-loud regression net | BM26 `be6b316` |
| LED↔DMX parity (controller type, RGBW out, white viz, strand views) | strands fully first-class | BM26 `98f781b`, `84c5cd8` |
| "Show Guides" pixels-only toggle | — | BM26 `eda4e88` |
| Test Auto-Patch + Clear All Patches | one-click whole-rig test patching | BM26 `72f2a8a` |
| Titanic model audit + view-gen suggestions | — | BM26 `2e0860c` |
| **Tier-C: `viewMaskHi` (62 in-VM views)** | firmware + host | MarsinLED `e915c23`, BM26 `94dec87` |
| Whole-ship auto-view catalog (`deriveAutoViews`) | 31 auto-views on titanic, bit-free | BM26 `7c2fc3e` |
| Art-Net output transport (sACN + Art-Net) | per-controller protocol | BM26 `760f38b` |
| True per-pixel `localIndex` from exporter | sweep-along-fixture in pixel order | BM26 `3f3559b` |
| `inView("Name")` intrinsic + on-demand bit promotion | bit-free views testable in-VM | BM26 `2ee383a` |
| Sim sACN auto-subscribe + brighter titanic | kills UNIVERSE MISMATCH edge | BM26 `e3daddc` |

---

## 3. Phase 1 — Validation (proofs + screenshots)

- **Visual (5/5 PASS, screenshots inspected):** brighter titanic (0.05→0.7),
  auto-view filtering (PORT/STARBOARD/@BAR, zero leak), `inView("PORT")` →
  exactly 485 px, sACN auto-subscribe (no mismatch banner), Art-Net controller
  toggle.
- **Automated (8/8 PASS):** suites 899/118; perf golden byte-identical; Tier-C
  62-view exact via vendored WASM (zero cross-word leak); fixture-type byte-exact
  both models; inView promote+select exact; localIndex correct + partial throws;
  Art-Net packet bytes + loopback; back-compat byte-identical.
- **Code-quality (YES-WITH-FINDINGS):** auto-checks green; one real MAJOR — the
  **bit:0 silent-zero** (Tier-A views injected as `MASK_X = 0`) — **fixed +
  pushed** (`6f2b9f7`, +regression test). Minors noted.

---

## 4. Phase 2 — Firmware adversarial flaw-hunt → fix → cold-review loop

Two independent flaw-finders, then iterative fix → **cold adversarial review**
to convergence. Every round found a *distinct* real bug — the loop earned its keep:

| Round | Found | Severity | Fix |
|---|---|---|---|
| Flaw-finders (×2) | VM value-stack overflow (SEGV); writable metadata builtins (shadowing defeats Tier-C); strings in numeric contexts; `viewMaskHi[expr]` leak; gray-return UB; array-index UB; string-pool truncation | 2 BLOCKER + 2 MAJOR + minors | `f93ef60` |
| Cold review #1 | shadow via **render-function param** + **for-loop var**; strings in **for-header** | 2 BLOCKER + 1 MAJOR (fix was incomplete) | `2fd227e` (narrow `isMetadataBuiltinName` predicate — intrinsics preserved) |
| Cold review #2 (on `2cadd03`) | strings in **array element/literal**; `OP_DUP` silent overflow | 1 MINOR + 1 NIT | `2cadd03` |
| Cold review #2 re-run | — | **PRODUCTION-READY: YES**, benign NITs only | — |

**Closed & independently reproduced (cold review #2):** read-only builtins (20
names × every shadow path), viewMaskHi single-bit guard (incl. the float-trap),
strings (all contexts), VM stack (VM_PUSH backstop, ASan-clean), numeric safety
(NaN-sentinel cannot reach an LED), ABI integrity (opcodes/metaBuf/JSON),
byte-identical back-compat (74-pattern FNV).

**Residual benign NITs (acceptable):**
1. `PixelMeta` defaultMeta lanes 0–5 truncate values >65535 to uint16 (lane 6
   strictly rejects). **Pre-existing** at baseline, off the BM26 host path,
   malformed-input-only — not a mislighting risk.
2. Vendored WASM **version tag** lags one commit (content verified current).

---

## 5. Integration — hardened WASM re-vendored into BM26 (`9f284d4`)

- All **113 BM26 patterns** compiled through the hardened compiler against both
  `test_bench` and `titanic` = **226 compiles, zero hardening rejections.**
- Engine **899/899**, sim **118/118**, **all 6 perf golden hashes byte-identical**
  (the stricter build changes valid-pattern output by nothing).
- Hardening **confirmed reached BM26**: shadowing `viewMaskHi`/`fixtureType` and
  storing a string in an array are now rejected through the committed BM26 WASM;
  the old vendored build accepted all three.

---

## 6. Remaining items (none block the branch)

**Hardware / operator (not engineering):**
- [ ] **ESP32 `pio run`** across all 5 firmware envs on a networked build host —
  the one must-do-before-flashing (sandbox network policy blocks the toolchain).
- [ ] Real titanic patching + real LED-controller binding (operator config).
- [ ] Re-export models to pick up the exporter `localIndex` field.
- [ ] Real Art-Net hardware confirmation (packet format + routing unit-proven).

**Engineering follow-ups (nice-to-have):**
- [ ] sim→engine controllers bridge (per-controller protocol/LED config to the engine model).
- [ ] Refresh the vendored WASM version-tag string (cosmetic).
- [ ] Per-fixture (vs group) high-view UI authoring.
- [ ] (Optional) make the pre-existing PixelMeta uint16 truncation fail loudly for parity.

**Process:**
- [ ] Open PRs (cross-repo MarsinLED↔BM26 dependency noted) + watch CI — on request.
- [ ] File the above as Notion cards if the connection is enabled.

---

## 7. Branch state

- **MarsinLED** `dev/claude/views_rehaul` → `2cadd03` (pushed) — Tier-B/C +
  full hardening, 2 cold adversarial reviews, PRODUCTION-READY.
- **BM26-Titanic** `dev/claude/views_rehaul` → `9f284d4` (pushed) — full feature
  arc + hardened WASM vendored, 899/118 green, goldens byte-identical.

Both trees clean (only expected engine smoke residue, uncommitted per codex).
