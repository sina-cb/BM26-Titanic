# Design — MarsinScript string support (interned-handle scheme)

**Date:** 2026-06-18
**Author:** Designer/Investigator agent
**Type:** Investigation + design (no production code changed; no git ops)
**Status:** Proposal for Sina review. Foundational — recommended to land first,
before Task 1 (fixture types) and Task 2 (named masks).

---

## 0. TL;DR

- **Current value model:** every MarsinScript value is a single numeric scalar
  (float/double, Pixelblaze-style). There is **no string type in the VM at all**
  — strings exist only at *compile time* (identifier names, the export `name`
  field) and never as runtime values.
- **Why no strings today:** the language is a hand-written recursive-descent
  compiler + tiny VM (C++ → WASM) whose entire value representation is "one
  number." A string would need a value tag and a backing store the VM doesn't
  have. Adding heap strings to the per-pixel hot path (40 fps × N pixels) is
  exactly the cost we must avoid.
- **Recommended design:** **compile-time string literals + an interned string
  constant pool.** A string literal compiles to an **integer handle** (its index
  in a per-pattern string pool). At runtime a string-typed value is *just that
  integer* — no allocation, no byte work, numeric ops stay untouched. Supported
  ops: assignment, pass-as-arg, equality/compare of handles, and
  **registry lookup** (`name → id`). Deliberately excluded: per-frame
  concatenation, slicing, char access, `toString(number)` in hot loops — these
  fail loudly at compile time (codex P0, no fallback).
- **Why it's the right foundation:** the repo **already ships this exact pattern
  in JS** — `view_mask_constants.js` rewrites `MASK_FOO` names to integer `var`
  declarations *before the compiler sees the code*. The interned-string design
  generalizes that one-off into a first-class `name → id` registry that Task 1
  and Task 2 both consume directly.

> **CRITICAL CONSTRAINT discovered:** the MarsinScript compiler + VM are **C++
> compiled to WebAssembly and vendored as a prebuilt binary only**
> (`marsin_pb/wasm/marsin-engine.{wasm,cjs,js}`). The C/C++ source is **not in
> this repo.** See §6 — this changes the implementation plan substantially and
> is the #1 open question for Sina.

---

## 1. Language / compiler / VM map (file:line)

### 1.1 The VM is a vendored WASM binary; C++ source is out-of-repo

- `marsin_engine/lib/marsin_wasm_runtime.js:1-13` — header: *"uses the actual
  MarsinVM compiled to WebAssembly via Emscripten … same compiler, same VM,
  same bytecode"* as the ESP32 firmware.
- `marsin_engine/lib/marsin_wasm_runtime.js:29-55` — loads
  `marsin_pb/wasm/marsin-engine.cjs` + `.wasm` and `cwrap`s the C ABI:
  `marsin_compile(string)→handle`, `marsin_get_error()→string`,
  `marsin_destroy_vm`, `marsin_begin_frame(handle, elapsed)`,
  `marsin_render_pixel/all/all_with_meta(_6ch)`, `marsin_set_control`,
  `marsin_get_exports_json(handle)→string`.
- `marsin_pb/wasm/` contains **only** `marsin-engine.wasm` (≈226 KB),
  `marsin-engine.cjs`, `marsin-engine.js`. **No `.c/.cpp/.h`** anywhere in the
  repo (`find … -name '*.cpp'` returns only `control_podium/firmware`). The WASM
  was built with Emscripten/clang (`strings` shows
  `/emsdk/emscripten/system/lib/libcxxabi/...`, `emscripten_resize_heap`).
- Implication: lexer/parser/opcode/VM live in a **separate firmware/compiler
  repo** that produces this binary. We cannot edit them from BM26-Titanic. See
  §6.

### 1.2 Confirmed shape of the language (from the binary + patterns + docs)

- **Recursive-descent parser, numeric-only.** Error strings in the binary:
  `Unexpected char`, `Expected '(' after function name`, `Expected ']'`,
  `Expected ';'`, `Undefined var `, `Unexpected end of file, missing '}'`,
  `Collision on exported control parameter`. Hand-written, classic PB-style.
- **Surface syntax** (`.agent/00_gol/08_patterns.md`, `marsin_engine/README.md`,
  `patterns/07_shimmer.js:6-19`): `export var X = 0.5;`,
  `export function sliderX(v){...}`, `var t;`, `beforeRender(delta)`,
  `render(index,x,y,z)`, builtins `hsv`, `rgb`, `rgbwau`, `time`, `wave`,
  `triangle`, `square`, `sin/cos` (radians, per `08_patterns.md:25`), `pow`,
  `sqrt`, `clamp`, `floor`, `ceil`, `perlin`, `random`. Every operand and
  every builtin arg/return is a number.
- **No string literal support today.** `strings` on the binary shows only
  *compiler-internal* literals (`basic_string`, `: no conversion`,
  `Compilation Failed:`); there is no string-value opcode, no string builtin,
  no `"..."` token handling beyond what the lexer needs (it likely rejects
  `"` as `Unexpected char`). `view_mask_constants.js:64-67` explicitly notes
  *"String literals are rare in MarsinScript"* — i.e. effectively unused/absent.

### 1.3 The one place strings already exist: the export table (compile-time only)

- `marsin_get_exports_json` emits records shaped
  `{"id":%u,"kind":%u,"name":"%s"}` (format string visible in the binary).
- `kind` enum strings present in the binary: `slider`, `toggle`, `trigger`,
  `hsvPicker` (+ color pickers).
- Consumed by `lib/wasm_host.js:138-145` / `marsin_wasm_runtime.js:185-192`
  (`getExports → JSON.parse`).
- **Key insight:** the compiler *already* keeps identifier name strings around
  at compile time and serializes them out as metadata. Runtime control flow,
  by contrast, is pure numbers: `setControl(id:int, v0:float, v1, v2)`
  (`wasm_host.js:132-136`). So "names at author time, integers at runtime" is
  **already the established contract** — strings as runtime values were simply
  never needed.

### 1.4 The runtime hot path (where strings must NOT intrude)

- Per frame (`marsin_engine/engine.js`): `mixer.beginFrame(elapsed)`
  (`engine.js:607`) → `mixer.renderAll6ch()` (`engine.js:623`) which calls
  `marsin_render_all_with_meta_6ch` once per channel, looping all pixels inside
  WASM at 40 fps. `engine.js:610` already flags this as the expensive pass
  ("N extra ... per-channel vis pre-pass").
- `render(index,x,y,z)` runs **once per pixel per channel per frame** — on
  Titanic that's hundreds of pixels × several mixer channels × 40 fps. This is
  the loop that must stay allocation-free and branch-light.
- **Compile** happens only on pattern swap / live-edit / blend setup
  (`engine.js:903`, `wasm_host.js:82-94`), **never per frame.** This is the
  whole reason the interned/compile-time approach is free at runtime: all
  string work happens in `marsin_compile`, none in `render`.

### 1.5 The existing `name → integer` precedent (the prototype to generalize)

- `marsin_engine/lib/view_mask_constants.js` (whole file) is a working
  **compile-time name→int substitution**:
  - `buildMaskConstants()` (`:40-58`) builds `{MASK_REDWOOD_PARS: 64, ...}` from
    the model's group bits + view-mask presets.
  - `injectMaskConstants(source, constants)` (`:92-113`) scans the pattern for
    `MASK_*` references and **prepends `var MASK_X = <bit>;` integer
    declarations** so the C++ compiler only ever sees integer literals. The VM
    "stays untouched — names are resolved to integer literals before the
    compiler ever sees the code" (`:8-10`).
  - Wired in at `wasm_host.js:82-94` (`compile()` funnels every compile through
    `injectMaskConstants`). Unknown `MASK_*` → **loud compile error**
    (`view_mask_constants.js:106-110`), never a silent zero — codex P0.
- Per-pixel metadata already flows as **integers** into the VM:
  `setPixelMeta` packs `controllerId / sectionId / fixtureId / viewMask` as four
  `Int32` lanes (`wasm_host.js:224-247`, `marsin_wasm_runtime.js:134-152`).
  The model carries the human names (`group`, `fId`, `sId`, `cId`) per pixel
  (`.agent/02_reports/202606/20260618_5_serialized_vis_and_dmx_layout_spec.md`).
- So the rig today is: **names live in the model/JS, integers reach the VM.**
  String support just makes that bridge first-class and author-visible *inside*
  the pattern language.

---

## 2. Why strings are unsupported today (root cause)

1. **Single-tag numeric value representation.** The VM stores every value as one
   number. There is no type tag, so there is nowhere to record "this slot is a
   string handle vs a float." Adding strings means either (a) a tag, or (b) a
   convention that certain slots are handles (the interned approach — see §3).
2. **No backing store / GC.** Real (mutable, concatenable) strings need a heap +
   lifetime management inside the WASM VM. The VM is deliberately tiny and
   allocation-free in the hot path for 40 fps determinism
   (`08_patterns.md:32` "bounded execution", "avoid intensive loops").
3. **It was never needed.** Everything the system wants names for (exports,
   masks, fixtures) was solved by keeping names in JS/the model and shipping
   integers to the VM (§1.3, §1.5). Strings-as-runtime-values had no use case
   until Tasks 1 & 2 asked for human-readable names *inside pattern code*.

---

## 3. Proposed design — interned string constant pool (handles)

### 3.1 The four options, with perf tradeoffs

| Option | Runtime cost in `render()` | Mutability | Verdict |
|---|---|---|---|
| **A. Compile-time-only strings** (literal allowed only where it folds to a number at compile time, e.g. `maskId("RedwoodPARs")`) | **Zero** — no string ever exists at runtime | None | Simplest; may be *too* limited (can't store a string in a var). |
| **B. Interned handles** (literal → integer index into a per-pattern string pool; string-typed value = that int) | **Zero alloc, zero byte-work**; ops on strings are integer ops | Immutable; pool fixed at compile | **RECOMMENDED.** Strongest balance. |
| **C. Heap strings** (real mutable strings with a VM heap) | Allocation + GC pressure in hot path; non-deterministic | Full | **Rejected** — breaks 40 fps determinism, codex bounded-execution. |
| **D. NaN-boxing / typed slots** (add a type tag to every value) | Tax on *every numeric op* (untag/retag) | Depends | **Rejected** — penalizes existing numeric-only patterns; violates "zero cost for back-compat." |

**Recommendation: B (interned handles), with A as the trivially-included subset**
(a literal used purely as a `name → id` argument folds at compile time and never
even enters the pool unless assigned to a variable).

### 3.2 How it works

**Literal syntax.** Add `"..."` (and/or `'...'`) string literals to the lexer.
A string literal is *interned*: the compiler keeps a per-pattern
`StringPool` (a `vector<string>` + `map<string,uint32_t>` dedup), and the
literal compiles to a `PUSH_STRING <poolIndex>` — which on the value stack is
**just the integer `poolIndex`**. There is no separate runtime string object.

**Value representation.** A string-typed value at runtime **is the integer
handle.** Numeric values are unchanged. The VM does not need a type tag for
correctness of arithmetic, because:
- String handles only ever flow into operations that expect handles (equality,
  compare, registry lookup, the `name`-taking builtins).
- The *compiler* (which has full type info from the AST) rejects mixing — e.g.
  `"foo" + 1` is a **compile error**, not a runtime coercion (codex: fail
  loudly). So no runtime tag check is needed in the hot path.
- (If we later want runtime type safety, a single high-bit convention on the
  handle is possible — but it is **not required** for v1 and must not touch the
  numeric fast path.)

**Constant pool in the bytecode.** The pool is emitted into the compiled
artifact as a length-prefixed table appended after the code section
(`[count][len0][bytes0][len1][bytes1]...`). It is loaded once at
`marsin_compile` time and lives for the VM handle's lifetime. **It is never
touched during `render`/`beforeRender`** — handles index it only for the
explicitly-supported, non-hot-path ops (mostly the registry lookup which itself
resolves to an int at compile time; see §3.4).

**Flow through the VM without slowing numeric ops.** The numeric stack machine
is untouched: `PUSH_STRING n` pushes the integer `n` exactly like `PUSH_CONST`
pushes a float. `OP_ADD`/`OP_MUL`/etc. never see a string because the compiler
forbade it. Existing numeric-only patterns compile to the exact same bytecode as
before and execute identically — **zero added instructions, zero added
branches** (§5 back-compat).

### 3.3 New opcodes / value tag

Minimal new bytecode surface:
- `PUSH_STRING <u32 poolIndex>` — push an interned handle.
- `STR_EQ` / `STR_NE` — handle equality. Because the pool is **deduped**, equal
  strings share one index, so equality is a single integer compare (`==`). No
  byte comparison ever runs.
- (Optional) `STR_CMP` for ordering, only if a use case needs sorted names; can
  be deferred.
- **No** `STR_CONCAT`, `STR_SLICE`, `STR_CHARAT`, `NUM_TO_STR` — see §4.

**No global value tag is added.** This is the crux of the zero-cost claim: we do
*not* widen the value representation or add a tag the numeric path must check.

### 3.4 The `name → id` registry (the bridge Tasks 1 & 2 stand on)

Generalize `view_mask_constants.js` into a first-class registry the *language*
exposes, resolved at **compile time**:

- The host injects a registry table per model (just like mask constants today):
  e.g. `fixtureType("UkingPar") → 3`, `maskId("RedwoodPARs") → 64`.
- A call like `maskId("RedwoodPARs")` or `fixtureType("UkingPar")` is a
  **compile-time fold**: the compiler looks the literal up in the injected
  registry and replaces the whole call with the resulting **integer literal**.
  The string never reaches the VM; the pool entry is elided.
- An unknown name is a **loud compile error** listing the known names
  (mirroring `view_mask_constants.js:106-110`) — codex P0, no silent fallback.
- A string stored in a *variable* (not folded) lands in the pool as a handle and
  can be compared (`STR_EQ`) or passed to a registry builtin that does the
  lookup — but per §4 we will *strongly prefer* the folded form and may restrict
  v1 to compile-time-resolvable lookups only.

This means: **author writes names, VM runs integers** — the exact contract that
already works for masks, now uniform and language-level.

---

## 4. Supported vs. deliberately-excluded operations

**Supported (cheap, mostly compile-time):**
- String literals `"..."`.
- Assignment to a `var`, passing as a function argument (handle moves as an int).
- Equality / inequality of handles (`STR_EQ`/`STR_NE`) — single int compare via
  pool dedup.
- `name → id` registry lookups (`maskId`, `fixtureType`, future `sectionId`,
  …) — **folded to an integer at compile time** wherever the argument is a
  literal (the overwhelmingly common case).
- The existing export `name` metadata — unchanged, already works.

**Deliberately excluded (fail loudly at compile time — codex P0):**
- **Concatenation** (`"a" + b`) — would need per-frame allocation. Rejected
  outright; `+` on a string is a compile error.
- **Slicing / indexing / `charAt` / `length` as runtime ops** — no use case,
  invites hot-loop byte work.
- **`number → string` formatting** in patterns — no rendering target for text;
  excluded.
- **Mutable strings** — the pool is immutable.
- **Mixing string and number in arithmetic / passing a string where a number is
  expected** — compile error, never a coercion or a silent `0`.

Rationale: the hot path (`render`) must stay numeric and allocation-free. Every
excluded op is one that would either allocate at 40 fps or hide a type error.
Failing at compile time keeps the 40 fps guarantee and honors the no-fallback
rule.

---

## 5. Back-compat (zero runtime cost for existing patterns)

- Existing numeric-only patterns contain **no string literals**, so the lexer
  change (recognizing `"`) never fires, the pool stays empty/absent, and the
  emitted bytecode is **byte-identical** to today. No new opcode executes.
- The numeric value representation is **unchanged** — no tag, no widening — so
  `OP_ADD` et al. cost exactly what they cost now. This is the explicit reason
  to reject options C and D (§3.1).
- The export-name path (`marsin_get_exports_json`) is untouched.
- `view_mask_constants.js` injection keeps working; if/when its job is absorbed
  by the language-level registry, the JS injector can become a thin shim or be
  retired — but that is a follow-up, not a prerequisite.

---

## 6. Exact files that change + the binary-source problem

### 6.1 The hard reality

The lexer/parser/opcodes/VM are in the **out-of-repo C++ compiler** that builds
`marsin_pb/wasm/marsin-engine.wasm`. **None of the four "core" changes
(lexer, parser, opcode table, VM dispatch) can be made inside BM26-Titanic.**
They must be made in the MarsinScript compiler/firmware source, then the WASM
re-built and the artifact re-vendored.

**Core changes (in the external C++ compiler/VM repo — NOT this repo):**
1. **Lexer** — tokenize `"..."` string literals (and escapes).
2. **Parser** — accept string literals as primary expressions; type-check
   string vs number; emit compile errors for excluded ops (§4).
3. **String pool + interning** — `vector<string>` + dedup map; emit pool into
   the bytecode; resolve registry folds at compile time.
4. **Opcodes** — add `PUSH_STRING`, `STR_EQ`/`STR_NE` (+ optional `STR_CMP`).
5. **VM** — handle the new opcodes (push int, int-compare); load the pool table
   at VM init. No change to the numeric dispatch.
6. **Re-build** with Emscripten and re-vendor
   `marsin_pb/wasm/marsin-engine.{wasm,cjs,js}` (and, for parity, the ESP32
   firmware build).

**Changes inside THIS repo (the host side — these we *can* do):**
- `marsin_engine/lib/view_mask_constants.js` — generalize into a
  `name → id` **registry** module (or add a sibling `name_registry.js`) that
  builds the fixture-type / mask / section tables from the model and injects
  them. Tasks 1 & 2 consume this.
- `marsin_engine/lib/wasm_host.js:82-94` — extend `compile()` to inject the new
  registry tables (today it only injects mask constants).
- Model loaders / `models/*.js` + the engine's mask wiring
  (`engine.js:~437`) — expose fixture-type and section name tables.
- Possibly `getExports`/control plumbing if any export wants a string label
  beyond what exists (likely none needed).

### 6.2 Pragmatic fallback if the C++ source is unavailable to us

If we cannot touch the external compiler in time, **Tasks 1 & 2 do NOT actually
need VM string support** — they need `name → id`. We can ship the *entire*
author-facing benefit **today, purely in JS**, by extending the
`view_mask_constants.js` compile-time-injection pattern to fixture types and
named masks (fold `fixtureType("UkingPar")`/`MASK_*`-style names to integer
literals before `marsin_compile`). That is the **recommended near-term path**
and it is the same scheme the real language feature would formalize later. The
true in-VM string type (storing a handle in a var, `STR_EQ`) is the part that
genuinely requires the C++ change; scope whether Tasks 1 & 2 need that or just
the fold. **This is the top question for Sina (§8).**

---

## 7. How this serves Task 1 (fixture types) and Task 2 (named masks)

Both tasks want **human-readable names in pattern code that cost nothing at
runtime.** The interned-handle + compile-time-registry design gives exactly
that:

- **Task 2 (named masks):** already half-built. `view_mask_constants.js` turns
  `MASK_REDWOOD_PARS` into the integer bit. Promoting this to
  `maskId("RedwoodPARs")` (or keeping the `MASK_*` sugar) under one registry
  makes mask names first-class and validated, resolving to the same `Int32`
  `viewMask` lane already fed per pixel (`wasm_host.js:224-247`).
- **Task 1 (fixture types):** the model already carries `fId`/fixture data and
  pushes `fixtureId` as an `Int32` lane into the VM. `fixtureType("UkingPar")`
  folds to that integer type id at compile time, so a pattern can do
  `if (fixtureType("UkingPar") == thisFixtureType) ...` with the comparison
  being a plain integer op in the hot path.
- In both cases: **names exist at author time; integers reach the VM.** The
  registry is the single `name → id` table both tasks register into, and the
  string design (even just its compile-time fold) is the mechanism that makes
  the lookup safe (unknown name = loud error) and free (no runtime string).

---

## 8. Recommended order, risks, open questions

### Implementation order (this task is foundational → first)
1. **Decide scope with Sina** (§8 questions) — especially whether we have access
   to the C++ compiler/VM source, and whether Tasks 1 & 2 need in-VM strings or
   just the compile-time fold.
2. **Ship the JS-side `name → id` registry** (generalize
   `view_mask_constants.js`) — unblocks Tasks 1 & 2 immediately, zero binary
   change, zero runtime cost. **Land this first regardless.**
3. **If/when the C++ feature is greenlit:** lexer → parser/type-check → string
   pool + interning → opcodes → VM → re-vendor WASM → ESP32 parity build →
   auto-checks (`.agent/00_gol/05_marsin_engine_auto_checks.md`).
4. Tasks 1 and 2 build on step 2 (and optionally consume step 3's literals).

### Risks
- **R1 (highest): the compiler/VM source is out-of-repo.** Real string opcodes
  require rebuilding a binary we don't have sources for here. Mitigation: §6.2
  JS-only fold path covers Tasks 1 & 2.
- **R2: ESP32 parity.** Any VM change must rebuild firmware too, or sim/hardware
  diverge (the binary's whole selling point is bit-exact parity,
  `marsin_wasm_runtime.js:5-7`). Strings must compile to *identical* bytecode on
  both targets.
- **R3: line-number drift.** Compile-time injection shifts pattern line numbers
  in error messages (already a known, bounded effect —
  `view_mask_constants.js:73-76`). Keep injection to one prepended line block.
- **R4: scope creep into heap strings.** Must hold the line on no concat / no
  mutable strings, or 40 fps determinism is at risk.
- **R5: collisions.** `name → id` tables must throw on sanitized-name collisions
  (pattern already enforced — `view_mask_constants.js:43-51`).

### Open questions for Sina
1. **Do we have the MarsinScript compiler/VM C++ source** (the firmware/compiler
   repo that builds `marsin-engine.wasm`), and can we modify + re-vendor it?
   This is the gating decision.
2. **Do Tasks 1 & 2 actually need in-VM string *values***, or is the
   **compile-time `name → id` fold** sufficient? If the latter, we can ship
   entirely in JS now and defer the C++ work.
3. **Literal quoting:** `"..."` only, or also `'...'`? (Mask injector currently
   ignores string literals — `view_mask_constants.js:64-67` — so adding quotes
   needs that scanner to skip them.)
4. **Equality semantics:** is handle equality (interned, exact-match) enough, or
   is any case-insensitive / ordered compare needed? (Affects whether we add
   `STR_CMP`.)
5. **Sugar choice:** keep `MASK_*` identifier sugar, move to
   `maskId("...")`/`fixtureType("...")` calls, or support both during a
   transition?

---

## 9. Appendix — key references

- Value model / numeric-only: `08_patterns.md:31-34`,
  `patterns/07_shimmer.js:6-19`, `patterns/rainbow.js`.
- WASM C ABI: `marsin_wasm_runtime.js:44-55`, `wasm_host.js:56-66`.
- Hot path: `engine.js:607,610,623`; compile path: `engine.js:903`,
  `wasm_host.js:82-94`.
- Existing name→int precedent: `lib/view_mask_constants.js` (all),
  per-pixel int meta `wasm_host.js:224-247`.
- Binary-only fact: `marsin_pb/wasm/` (only `.wasm/.cjs/.js`); built by
  Emscripten (`libcxxabi` path string in the binary).
- Exports name metadata: `{"id":%u,"kind":%u,"name":"%s"}` format string in the
  binary; consumed `wasm_host.js:138-145`.
