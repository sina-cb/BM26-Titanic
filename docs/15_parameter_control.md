# 15 — Parameter Control / Central Parameter Center (CPC)

## 1. Problem Statement

Pattern parameters are fully scoped to each pattern file. Every pattern independently declares `export var speed`, `export function sliderSpeed(v)`, etc. The CaptainPad iPad and WS clients manipulate these via `setControl(id, v0, v1, v2)` where `id` is a CRC32 hash of the export name.

**Problems:**
1. **No shared vocabulary.** Per-pattern control state is persisted in `pattern_state.yaml` and restored via `applyPersistedState()`, so sliders survive a round-trip to the same pattern. But state is pattern-scoped, keyed by control ID — there is no way to express a shared speed or shared color that carries across pattern transitions. Switching patterns loads an entirely different set of control IDs.
2. **Every pattern reinvents the wheel.** Most declare nearly identical params (`speed`, `baseHue`, etc.) with incompatible names, ranges, and semantics.
3. **No external automation.** No OSC, MIDI, or general-purpose input layer exists.
4. **No source arbitration.** Multiple simultaneous sources have no deterministic precedence.

---

## 2. Architecture Overview

The CPC is a **singleton module** inside `marsin_engine` alongside `IntensityController` and `GlobalEffectsController`. It manages _pattern-level_ shared parameters, not hardware brightness/effects.

```
 ┌──────────┐  HTTP/WS    ┌───────────────────────────────────────────┐
 │ CaptainPad├────────────►│         Central Parameter Center          │
 │  (iPad)   │             │                                           │
 └──────────┘             │  ┌─────────────────────────────────────┐  │
 ┌──────────┐  OSC (UDP)  │  │         Source Arbitrator            │  │
 │ TouchOSC  ├────────────►│  │                                     │  │
 │ QLab etc  │             │  │  Global Lock ──┐                    │  │
 └──────────┘             │  │  Per-Param Own ─┼► Validated Store   │  │
 ┌──────────┐  HTTP REST  │  │  Priority Rank ─┘     │              │  │
 │ REST/MIDI ├────────────►│  └─────────────────────┬─┘              │  │
 └──────────┘             │                        │ dirty flag      │  │
                          │                        ▼                 │  │
                          │  ┌────────────────────────────────────┐  │  │
                          │  │    Event-Driven WASM Injection     │  │  │
                          │  │  (only on value change or swap)    │  │  │
                          │  └────────────────────────────────────┘  │  │
                          │                        │                 │  │
                          │                        ▼                 │  │
                          │  ┌────────────────────────────────────┐  │  │
                          │  │  Canonical Broadcast (WS + HTTP)   │  │  │
                          │  │  { revision, origin, params }      │  │  │
                          │  └────────────────────────────────────┘  │  │
                          └──────────────────────────────────────────┘
```

### Key Principles

- **Server-authoritative.** The CPC holds canonical state. Clients send fire-and-forget updates. Server broadcasts canonical state with revision/origin metadata.
- **Event-driven injection.** Shared params are injected into the WASM VM only when a value actually changes or a new pattern is loaded — NOT unconditionally every frame.
- **Explicit ownership.** When a pattern opts into a shared param, the CPC _owns_ that control ID. Per-pattern local sliders and shared params never collide.
- **Schema-driven UI.** CaptainPad renders shared controls from `/param-center/schema`, not from the pattern export list.

---

## 3. Injection & Ownership Model

### 3.1 The Problem with Every-Frame Injection

If the CPC injects `speed = 0.5` into the WASM VM every frame via `setControl()`, and the iPad also sends a per-pattern `sliderSpeed` write via the normal `/control` endpoint, the CPC injection on the _next_ frame will overwrite the iPad's value. This makes per-pattern sliders and CPC injection incompatible when they target the same underlying variable.

### 3.2 Solution: Exclusive Variable Ownership + Dirty-Flag Injection

**Rule: A given pattern variable must be written by exactly one control path.**

Control-ID separation alone is not sufficient. `sharedSpeed(v)` and `sliderSpeed(v)` have different CRC32 control IDs and different WASM callbacks, but both callbacks can assign the same `speed` variable inside the pattern. If the local slider changes `speed` between CPC injections, the rendered output diverges from the CPC's canonical value — and the CPC has no way to know.

> [!CAUTION]
> **Exclusive-variable rule:** When a pattern opts into a shared param (e.g., declares `export function sharedSpeed(v)`), it **must not** also declare a local slider that writes the same underlying variable (e.g., no `export function sliderSpeed(v) { speed = ... }`). The `shared*` function is the sole writer for that variable.

Enforcement layers:

1. **Pattern authoring convention (primary).** Pattern authors choose: either use `sharedSpeed` (CPC-controlled) or `sliderSpeed` (local iPad-controlled) for a given variable, never both. This is documented as a hard rule in the pattern style guide.
2. **Name-based heuristic detection (best-effort).** `rebuildControlMap()` scans the export list for names that pair a `shared*` export with a corresponding `slider*` or `hsvPicker*` export of the same semantic role (e.g., `sharedSpeed` + `sliderSpeed`). If found, it logs a warning broadcast as a WS diagnostic so the iPad Studio tab can surface it.

   > [!NOTE]
   > Name-based detection is **heuristic only**. It cannot catch all conflicts — a callback named `sliderRate` could still write the `speed` variable. `runtime.getExports()` exposes names, kinds, and IDs, but not callback write-sets. For guaranteed enforcement, use the source-level lint below.

3. **Source-level lint / metadata (recommended for guarantees).** A pre-compile lint pass (or an explicit `@shared speed` JSDoc annotation in the pattern header) can parse the pattern source to verify that no non-`shared*` callback assigns a shared-owned variable. This is the only reliable way to prove write exclusivity. Until implemented, the authoring convention is the primary safeguard.
4. **Control-ID blocking at the API boundary (enforced).** Filtering a conflicting export from the CaptainPad broadcast only removes discovery — the current `POST /control` endpoint and WS `setControl` handler accept arbitrary control IDs, so any API client, persisted state, or computed CRC32 can still invoke the blocked callback. To close this gap, `rebuildControlMap()` populates a **blocked-ID set**. The `/control` handler and WS `setControl` handler check this set and reject writes to blocked IDs with `{ status: "ignored", reason: "shared_ownership" }`. This is the hard runtime gate.

Local per-pattern controls that target _different_ variables are unaffected. For example, `sliderTailLength` writes `tailLength` — a variable no shared param touches — and coexists safely.

**Injection is event-driven, not per-frame:**

```
paramCenter.set('speed', 0.7, 'ipad')
  → store.speed.value = 0.7
  → store.speed.dirty = true
  → store.speed.revision++
  → broadcast canonical state to WS clients

// In render loop:
tick() {
  paramCenter.flushDirty(runtime);  // only calls setControl for dirty params
  runtime.beginFrame(elapsed);
  ...
}
```

`flushDirty()` iterates the param store, calls `runtime.setControl(id, v0, v1, v2)` only for params whose `dirty` flag is set, then clears the flag. This means:
- A param set once stays set in the WASM VM until changed again (WASM controls persist across frames).
- No interference with per-pattern sliders that write to different variables.
- Minimal overhead: typically 0 `setControl` calls per frame unless something changed.

### 3.3 Pattern Swap: Full Snapshot Apply

On every pattern swap, the CPC must re-apply ALL shared params (not just dirty ones), because the WASM VM was just recompiled and all control state was reset. The pattern lifecycle hook (§4) handles this.

---

## 4. Pattern Lifecycle Integration

### 4.1 Current Compile/Swap Sites (As-Is)

Pattern compilation happens in **four places** today:

| Site | File | Lines | Trigger |
|------|------|-------|---------|
| Initial boot | `engine.js` | 290–296 | CLI `--pattern` flag |
| `POST /set-pattern` | `api_server.js` | 175–209 | iPad/REST pattern switch |
| Autopilot timer | `api_server.js` | 63–83 | Autopilot `changePattern` callback |
| `POST /save-pattern` | `api_server.js` | 141–174 | Studio editor save (if active pattern) |

Each site independently calls `runtime.compile(src)`, updates `opts.pattern`, calls `applyPersistedState()`, and broadcasts WS messages. This duplication is fragile.

### 4.2 Solution: PatternLifecycle Hook

Introduce a central `onPatternCompiled(patternName, runtime)` hook that all four sites call after a successful compile. This hook orchestrates all post-compile side effects in a deterministic order:

```js
// In api_server.js (or a dedicated pattern_lifecycle.js)
function onPatternCompiled(patternName, runtime) {
  // 1. Update active pattern name
  opts.pattern = patternName;

  // 2. Restore per-pattern persisted slider state
  applyPersistedState(patternName);

  // 3. CPC: rebuild shared control map from new exports
  const exports = runtime.getExports();
  paramCenter.rebuildControlMap(exports);

  // 4. CPC: apply full shared param snapshot (all params, not just dirty)
  paramCenter.applySnapshot(runtime);

  // 5. Filter shared exports OUT of the broadcast list
  const filteredExports = exports.filter(e => !paramCenter.isSharedExport(e.name));

  // 6. Broadcast pattern + filtered exports to WS clients
  broadcastWs({ type: 'pattern', name: patternName });
  broadcastWs({ type: 'exports', data: mergeExportsWithState(filteredExports, patternName) });

  // 7. Broadcast current shared param state (spread to match §5.3 canonical shape)
  broadcastWs({ type: 'sharedParams', ...paramCenter.getCanonicalState() });
}
```

All four compile sites reduce to:
```js
const comp = runtime.compile(src);
if (comp.ok) onPatternCompiled(patternName, runtime);
```

### 4.3 Export Filtering

`rebuildControlMap()` scans `runtime.getExports()` for names matching the `shared*` prefix (e.g., `sharedSpeed`, `sharedColorPalette1`) and records their CRC32 IDs. `isSharedExport(name)` returns `true` for these names so they are excluded from the normal export broadcast.

> [!IMPORTANT]
> `sharedSpeed` will appear in `getExports()` as `kind: 4` (exported var accessor), which CaptainPad already ignores (it only renders kinds 1, 2, 3, 6). But we still explicitly filter them out to prevent confusion and ensure correctness regardless of future `kind` changes.

---

## 5. Server-Authoritative Readback

### 5.1 Why "No Feedback" Was Wrong

The previous design claimed "no feedback path" but also defined WS `sharedParams` broadcasts — a contradiction. More importantly, readback is necessary for:
- **CaptainPad stability:** Faders need to sync to canonical state on reconnect or app foreground.
- **Source-lock visibility:** The iPad must know if it's locked out and show that state.
- **Multi-client consistency:** Multiple iPads or OSC consoles need to converge.
- **Future MIDI feedback:** MIDI controllers with motorized faders need canonical values.

### 5.2 Canonical State Model

Every parameter update increments a global `revision` counter. The canonical state includes origin metadata:

```js
{
  revision: 42,
  sourceLock: null,              // or { mode: 'global', source: 'osc' }
  params: {
    speed:         { value: 0.7,  lastSource: 'ipad',  lastRevision: 40 },
    direction:     { value: 1,    lastSource: 'osc',   lastRevision: 38 },
    colorPalette1: { value: { h: 0.1, s: 1.0, v: 1.0 }, lastSource: 'ipad', lastRevision: 42 },
    ...
  }
}
```

### 5.3 Broadcast Protocol

The WS broadcast uses the **same canonical shape** as `GET /param-center` — nested params with per-param metadata, plus top-level `revision` and `sourceLock`. There is one canonical format everywhere.

`paramCenter.getCanonicalState()` returns `{ revision, sourceLock, params }`. The lifecycle hook and periodic broadcasts both spread this into the WS message, producing an identical shape:

**Server → Clients (WS broadcast):**
```json
{
  "type": "sharedParams",
  "revision": 42,
  "sourceLock": null,
  "params": {
    "speed":     { "value": 0.7, "lastSource": "ipad", "lastOrigin": "ipad-001", "lastRevision": 40 },
    "direction": { "value": 1,   "lastSource": "osc",  "lastOrigin": "osc",      "lastRevision": 38 }
  }
}
```

Broadcast on:
- Any shared param change (debounced to max 30Hz to avoid flooding during fader drags)
- Client WS connect (immediate full snapshot)
- Pattern swap (full snapshot as part of lifecycle hook)
- Source-lock change

**Clients → Server:**
```json
{ "type": "setSharedParam", "key": "speed", "value": 0.7, "origin": "ipad-001" }
```

The `origin` field is a **client instance ID** (e.g., `ipad-001`, `ipad-002`, `touchosc-main`), distinct from `source` (the adapter type like `ipad`, `osc`, `api`). Each param stores both `lastSource` and `lastOrigin`. This lets multiple clients of the same source type (e.g., two iPads both using source `ipad`) distinguish their own echoed updates — a client ignores broadcasts where `lastOrigin` matches its own ID.

### 5.4 Rejected Write Outcomes

Writes may be rejected due to source-lock policy. Rejected writes are **never silent** — the outcome is always observable:

| Transport | Accepted | Rejected |
|-----------|----------|----------|
| **HTTP** `POST /param-center` | `{ "status": "ok", "revision": 43 }` | `{ "status": "ignored", "reason": "source_lock", "lockedTo": "osc" }` (HTTP 200, not 4xx — the request was valid, just policy-filtered) |
| **WS** `setSharedParam` | Server broadcasts updated `sharedParams` | Server sends back `{ "type": "paramRejected", "key": "speed", "reason": "source_lock", "lockedTo": "osc" }` to the originating client only |
| **OSC** (UDP) | Value applied, visible in next canonical broadcast | Best-effort: value dropped. The lock state is visible via `GET /param-center` or WS. OSC adapters should log rejected writes at `warn` level with the source and key. Optional: if the OSC config enables `osc.errorReplies`, send an OSC reply to `/marsin/error` with the rejection reason. |

This ensures no client is left guessing whether its write was applied. The canonical broadcast always reflects ground truth regardless.

---

## 6. Shared Parameter Registry

### 6.1 Registry Fields

Each registered parameter has the following metadata:

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | Internal identifier, e.g. `speed` |
| `label` | `string` | Human-readable display name, e.g. `Speed` |
| `type` | `enum` | `float`, `int`, `hsv` |
| `default` | `any` | Default value on engine boot |
| `range` | `[min, max]` | Valid range (for clamping) |
| `options` | `array?` | For int enums: `[-1, 0, 1]` |
| `clamp` | `boolean` | Whether to clamp at CPC boundary (default `true`) |
| `slew` | `number?` | Optional smoothing rate (0–1, 0=instant, future) |
| `persist` | `boolean` | Save/restore across engine restarts |
| `oscAddress` | `string` | Full OSC path, e.g. `/marsin/param/speed` |
| `midiFuture` | `object?` | Future MIDI binding: `{ cc: 1, channel: 1, bits: 7 }` |
| `sharedFnName` | `string` | Expected pattern function name, e.g. `sharedSpeed` |
| `owner` | `string?` | Current source owner (if per-param lease active) |
| `lastSource` | `string` | Source adapter type that last wrote this param (`ipad`, `osc`, `api`) |
| `lastOrigin` | `string` | Client instance ID that last wrote this param (`ipad-001`, `touchosc-main`) — enables multi-client echo suppression (see §5.3) |
| `lastRevision` | `number` | Revision counter at last write |

### 6.2 Initial Registry

```js
const PARAM_REGISTRY = [
  {
    key: 'speed', label: 'Speed', type: 'float',
    default: 0.5, range: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/speed', sharedFnName: 'sharedSpeed',
  },
  {
    key: 'direction', label: 'Direction', type: 'int',
    default: 1, range: [-1, 1], options: [-1, 0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/direction', sharedFnName: 'sharedDirection',
  },
  {
    key: 'count', label: 'Count', type: 'float',
    default: 0.5, range: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/count', sharedFnName: 'sharedCount',
  },
  {
    key: 'size', label: 'Size', type: 'float',
    default: 0.5, range: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/size', sharedFnName: 'sharedSize',
  },
  {
    key: 'rotate', label: 'Rotate', type: 'float',
    default: 0.0, range: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/rotate', sharedFnName: 'sharedRotate',
  },
  {
    key: 'colorPalette1', label: 'Color 1', type: 'hsv',
    default: { h: 0.0, s: 1.0, v: 1.0 }, range: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/colorPalette1', sharedFnName: 'sharedColorPalette1',
  },
  {
    key: 'colorPalette2', label: 'Color 2', type: 'hsv',
    default: { h: 0.5, s: 1.0, v: 1.0 }, range: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/colorPalette2', sharedFnName: 'sharedColorPalette2',
  },
];
```

Adding new shared params: add a registry entry, declare `export function sharedNewParam(v)` in patterns that want it.

---

## 7. Source Arbitration

### 7.1 Arbitration Modes

The CPC supports three arbitration policies, configurable at runtime:

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Open** (default) | Last-write-wins, all sources accepted | Rehearsal, casual control |
| **Global Lock** | Only one named source can write; others rejected with explicit outcome (see §5.4) | Live performance, dedicated console |
| **Per-Param Lease** | Each param can be owned by a specific source; others rejected for that param only | Split control (OSC owns speed, iPad owns color) |

### 7.2 Global Lock

```
POST /param-center/source-lock
{ "mode": "global", "source": "osc" }     // Lock to OSC
{ "mode": "open" }                          // Unlock
```

When locked, the lock state is included in every canonical broadcast so all clients can see they are locked out and display appropriate UI (e.g., greyed-out faders on the iPad).

### 7.3 Per-Param Lease

```
POST /param-center/source-lock
{ "mode": "per-param", "leases": { "speed": "osc", "colorPalette1": "ipad" } }
```

Params without an explicit lease accept writes from any source (last-write-wins). This allows splitting control surface responsibilities without full lockout.

### 7.4 Observable State

All arbitration state is visible via `GET /param-center` and WS `sharedParams` broadcasts. No update is ever silently dropped without the state being observable — clients can always query to see if they're locked out and which source owns what.

---

## 8. CaptainPad Integration

### 8.1 Shared Controls from Schema, Not Exports

> [!IMPORTANT]
> CaptainPad currently renders pattern exports filtered by `kind`: 1 (slider), 2 (toggle), 3 (trigger), 6 (hsvPicker). The `shared*` functions appear as `kind: 4` (exported var), which are already invisible. But even if the kind were different, shared controls must NOT be rendered from the export list.

Shared controls are rendered from a **separate schema endpoint**:

```
GET /param-center/schema
→ [
    { key: "speed", label: "Speed", type: "float", range: [0,1], default: 0.5 },
    { key: "colorPalette1", label: "Color 1", type: "hsv", ... },
    ...
  ]
```

The iPad fetches this schema once on connect and renders a **persistent "Shared Parameters" section** above the per-pattern controls. This section does not change when patterns switch.

### 8.2 CaptainPad Shared Param API

New functions in `utils/api.ts`:

```typescript
export async function getParamCenterSchema() {
  return apiFetch('/param-center/schema');
}

export async function getParamCenterState() {
  return apiFetch('/param-center');
}

export async function setSharedParam(key: string, value: number | {h:number, s:number, v:number}) {
  return apiFetch('/param-center', 'POST', { [key]: value });
}

export async function setSourceLock(mode: string, source?: string | null, leases?: Record<string, string>) {
  return apiFetch('/param-center/source-lock', 'POST', { mode, source, leases });
}
```

### 8.3 UI Layout

```
┌──────────────────────────────────────────┐
│          SHARED PARAMETERS               │
│  (persistent across pattern switches)    │
│                                          │
│  ▌SPEED▐     ▌COUNT▐     ▌SIZE▐          │
│  ═══════     ═══════     ═══════         │
│  ▌ROTATE▐    ▌DIR▐                       │
│  ═══════     [◄ ● ►]                     │
│  [■ COLOR 1]  [■ COLOR 2]               │
│                                          │
│  Source: [ OPEN ▼ ]  🔒                   │
├──────────────────────────────────────────┤
│      PATTERN PARAMETERS — chasers        │
│  (from /exports, shared* filtered out)   │
│                                          │
│  ▌TAIL▐   [■ BASE]   [■ TAIL]           │
│  ═══════                                 │
└──────────────────────────────────────────┘
```

On WS connect, the iPad receives a `sharedParams` snapshot to seed fader positions. On reconnect or app-foreground, it re-fetches `GET /param-center` to sync.

---

## 9. OSC Adapter

### 9.1 Design

OSC is implemented as a **source adapter** — a thin UDP listener that parses messages and calls `paramCenter.set(key, value, 'osc')` through the same validated path as all other sources.

### 9.2 Address Space

Addresses are absolute and idempotent:

```
/marsin/param/speed           [float 0.0–1.0]
/marsin/param/direction       [int -1, 0, 1]
/marsin/param/count           [float 0.0–1.0]
/marsin/param/size            [float 0.0–1.0]
/marsin/param/rotate          [float 0.0–1.0]
/marsin/param/colorPalette1   [float h] [float s] [float v]
/marsin/param/colorPalette2   [float h] [float s] [float v]
/marsin/source-lock           [string source | "open"]
/marsin/pattern               [string patternName]
```

### 9.3 Stability Notes

- **Clamping:** All values are clamped at the CPC boundary per the registry's `range` and `clamp` fields. Out-of-range OSC values never reach the WASM VM.
- **Packet loss:** UDP is lossy. OSC sets absolute values (not deltas), so a dropped packet simply means the param stays at its previous value until the next packet. Clients that need guaranteed readback should use `GET /param-center` over HTTP.
- **Rate limiting:** OSC messages are processed immediately (no debounce) since the injection is dirty-flag based and the actual `setControl` only fires once per render frame regardless of how many OSC messages arrived.

### 9.4 Config

```yaml
osc:
  enabled: true
  port: 6970
  namespace: /marsin
```

---

## 10. MIDI Adapter (Future)

MIDI is modeled as another source adapter into the CPC, identical in role to OSC.

### 10.1 Design Notes

- **Soft Takeover / Pickup:** When a MIDI CC knob is turned, the CPC compares the incoming value to the canonical value. If the difference exceeds a threshold (e.g., >10%), the update is ignored until the knob "catches up" to the canonical position. This prevents parameter jumps when switching between sources.
- **14-bit CC:** For smooth fader control, support paired CC messages (MSB + LSB) to provide 14-bit resolution (16384 steps vs 128). Registry `midiFuture.bits` field documents this.
- **Controller Feedback:** MIDI controllers with motorized faders or LED rings should receive canonical state from the CPC broadcast, NOT from pattern exports. The CPC is the single source of truth.
- **Binding:** MIDI CC → param key mappings are stored in `config.yaml` under a `midi:` section, similar to OSC.

---

## 11. HTTP/WS API Reference

### 11.1 New HTTP Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/param-center` | — | `{ revision, sourceLock, params: { speed: { value, lastSource, lastRevision }, ... } }` |
| `POST` | `/param-center` | `{ speed: 0.7 }` or `{ colorPalette1: {h,s,v} }` | `{ status: "ok", revision: 43 }` or `{ status: "ignored", reason: "source_lock", lockedTo: "osc" }` (see §5.4) |
| `GET` | `/param-center/schema` | — | `[ { key, label, type, range, default, oscAddress, ... } ]` |
| `POST` | `/param-center/source-lock` | `{ mode: "global", source: "osc" }` | `{ status: "ok", sourceLock }` |

### 11.2 WebSocket Messages

**Client → Server:**
```json
{ "type": "setSharedParam", "key": "speed", "value": 0.7, "origin": "ipad-001" }
```

**Server → Client (broadcast, canonical shape matching §5.3):**
```json
{ "type": "sharedParams", "revision": 42, "sourceLock": null,
  "params": { "speed": { "value": 0.7, "lastSource": "ipad", "lastRevision": 40 }, ... } }
```

**Server → Originating Client Only (rejection, per §5.4):**
```json
{ "type": "paramRejected", "key": "speed", "reason": "source_lock", "lockedTo": "osc" }
```

Broadcast triggers: param change (debounced 30Hz), WS connect, pattern swap, source-lock change.

---

## 12. Persistence

Shared param values are persisted to `param_center_state.yaml` (separate from `pattern_state.yaml`) on every change (debounced). On engine restart, the CPC restores from this file.

```yaml
# param_center_state.yaml
speed: 0.7
direction: 1
count: 0.5
size: 0.5
rotate: 0.0
colorPalette1: { h: 0.1, s: 1.0, v: 1.0 }
colorPalette2: { h: 0.55, s: 0.9, v: 1.0 }
```

Source-lock state is NOT persisted (always resets to `open` on restart).

---

## 13. Pattern Opt-In Example

```js
// 10_chasers.js — with shared param opt-in

// ── Shared param opt-in (CPC owns these variables exclusively) ──
// NOTE: No sliderSpeed or hsvPickerColor — those would write the same
// variables and violate the exclusive-variable rule (see §3.2).
export var speed = 0.05;
export function sharedSpeed(v) { speed = 0.01 + v * 0.2; }

export var particleCount = 5.0;
export function sharedCount(v) { particleCount = 1.0 + floor(v * 20.0); }

export var baseHue = 0.0;
export function sharedColorPalette1(h, s, v) { baseHue = h; }

export var tailHue = 0.15;
export function sharedColorPalette2(h, s, v) { tailHue = h; }

// ── Per-pattern local controls (write DIFFERENT variables) ──
// These are safe: tailLength and tailHue are not shared-param targets.
export var tailLength = 0.15;
export function sliderTailLength(v) { tailLength = 0.02 + v * 0.3; }
```

**What happens:**
- `sharedSpeed`, `sharedCount`, `sharedColorPalette1`, `sharedColorPalette2` are detected by `rebuildControlMap()`, their CRC32 IDs are recorded, and they are filtered from the export broadcast.
- `sliderTailLength` writes `tailLength` — a variable no shared param touches — so it remains visible in the iPad's per-pattern export list as `kind: 1`.
- CPC injection writes to `sharedSpeed`'s control ID only when the value changes (dirty-flag).
- There is no `sliderSpeed` competing for the `speed` variable. The CPC is the sole writer.

> [!WARNING]
> **Anti-pattern:** Do NOT do this:
> ```js
> export function sharedSpeed(v) { speed = 0.01 + v * 0.2; }  // CPC writes speed
> export function sliderSpeed(v) { speed = 0.01 + v * 0.2; }  // Local also writes speed — CONFLICT!
> ```
> Both callbacks write the same `speed` variable. The local slider would overwrite the CPC's value between injection cycles. `rebuildControlMap()` will log a warning and filter `sliderSpeed` from the export broadcast to prevent this.

---

## 14. Controller Hierarchy

| Controller | Scope | Pipeline Stage | Persisted |
|------------|-------|----------------|-----------|
| **ParamCenter** | Pattern behavior (speed, color, density) | Pre-render: WASM injection (event-driven) | Yes (`param_center_state.yaml`) |
| **Autopilot** | Pattern scheduling (playlist, shuffle) | Pattern swap trigger | Yes (`config.yaml`) |
| **IntensityController** | Hardware brightness (per-section dimming, blackout) | Post-render: pixel scaling | Yes (`pattern_state.yaml` `_dimmers`) |
| **GlobalEffectsController** | Hardware effects (fogger, UV, vintage white) | Post-render: DMX bypass | No |

---

## 15. Implementation Plan

### Phase 1: Core Module
- [ ] Implement `ParamCenter` class with registry, store, validation, clamping
- [ ] Add dirty-flag tracking and `flushDirty(runtime)` method
- [ ] Add `rebuildControlMap(exports)` and `applySnapshot(runtime)`
- [ ] Add `isSharedExport(name)` filter
- [ ] Unit tests for set/get/clamp/dirty/rebuild

### Phase 2: Persistence & Schema
- [ ] Implement save/restore to `param_center_state.yaml`
- [ ] Implement `GET /param-center/schema` endpoint
- [ ] Implement `GET /param-center` and `POST /param-center` endpoints
- [ ] Implement `POST /param-center/source-lock` endpoint

### Phase 3: Pattern Lifecycle Hook
- [ ] Create `onPatternCompiled()` function
- [ ] Refactor all 4 compile/swap sites to call the hook
- [ ] Filter `shared*` exports from WS broadcast
- [ ] Add `flushDirty()` call to render loop in `engine.js`

### Phase 4: WS Broadcasts
- [ ] Add `sharedParams` broadcast on change (debounced 30Hz)
- [ ] Add `sharedParams` snapshot on WS connect
- [ ] Add WS `setSharedParam` message handler

### Phase 5: CaptainPad Update
- [ ] Add shared param API functions in `utils/api.ts`
- [ ] Fetch `/param-center/schema` on connect
- [ ] Render persistent "Shared Parameters" section from schema
- [ ] Add source-lock indicator and selector

### Phase 6: OSC Adapter
- [ ] Implement `osc_server.js` with UDP listener
- [ ] Route OSC messages through `paramCenter.set(key, value, 'osc')`
- [ ] Add `osc:` config section
- [ ] Test with TouchOSC

### Phase 7: MIDI Adapter (Future)
- [ ] Implement MIDI listener with soft-takeover/pickup
- [ ] Support 14-bit CC pairs
- [ ] Add controller feedback from CPC canonical state

### New/Modified Files

| File | Status | Purpose |
|------|--------|---------|
| `lib/param_center.js` | **NEW** | Core CPC: registry, store, validation, injection, persistence |
| `lib/osc_server.js` | **NEW** | OSC UDP adapter |
| `engine.js` | MODIFY | Instantiate CPC, add `flushDirty()` to render loop |
| `lib/api_server.js` | MODIFY | Add endpoints, WS handlers, `onPatternCompiled` hook |
| `config.yaml` | MODIFY | Add `param_center:` and `osc:` sections |
| `package.json` | MODIFY | Add `osc` dependency |
