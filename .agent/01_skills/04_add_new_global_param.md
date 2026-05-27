# Skill: Onboard a new Global Param end-to-end (CPC → OSC → CaptainPad → PortWatch)

Every "global" knob that operators expect to control from CaptainPad, OSC, REST, or any future surface (MIDI, mic, automation) lives in the **Central Parameter Center (CPC)** — `marsin_engine/lib/param_center.js`. Everything else (HTTP, WebSockets, OSC listener, CaptainPad sliders, PortWatch LoRa compact frames) reads its truth from there.

This skill walks the full add-a-param recipe from a single registry edit out to a working slider on the iPad, plus the optional PortWatch and OSC inputs. Use it for any param that should be:

- visible on every surface at once,
- arbitrated by source-lock (CaptainPad vs OSC vs API),
- restored across engine restarts (if persistent),
- broadcast to every connected client when it changes.

**Reference reading first:** `docs/15_central_param_center_cpc.md` and `docs/24_osc_integration.md §7`.

---

## TL;DR cheat sheet

| Step | File | Required? |
|---|---|---|
| 1 | `marsin_engine/lib/param_center.js` — add `PARAM_REGISTRY` entry | **always** |
| 2 | `marsin_engine/tests/param_center.test.js` — schema + default test | **always** |
| 3 | Restart engine; confirm `GET /param-center` exposes the key | **always** |
| 4 | `CaptainPad/components/CPCControls.tsx` (or new component) — surface UI | for operator-facing knobs |
| 5 | OSC config in `marsin_engine/config.yaml` (optional, only if non-canonical mapping) | OSC-controlled |
| 6 | `simulation/scenes/<scene>/patches.yaml` — expose to patterns via `sharedFnName` | pattern-controlled |
| 7 | PortWatch bridge — make sure `portWatch` flag is correct | LoRa parity |
| 8 | Tests + live verification | **always** |

The CaptainPad pill, source-arbitration, throttled broadcasts, persistence, and OSC canonical binding all derive from the registry entry — there is no other place to register a param.

---

## 1. Define the param in the CPC registry

Edit `marsin_engine/lib/param_center.js`. The registry is the *only* source of truth — see `marsin_engine/lib/param_center.js:15-68` for the live entries. The shape is:

```javascript
{
  key:           'myParam',                    // canonical CPC key — used in /param-center JSON, WS payload, source-lock leases
  label:         'My Param',                   // human label for UI / schema dumps
  type:          'float' | 'int' | 'hsv',      // type-aware clamping in clampValue()
  default:       0.5,                          // initial value; HSV uses { h, s, v }
  range:         [0, 1],                       // [min, max] for clamping
  clamp:         true,                         // reject writes outside range (HSV clamps per-component)
  options:       [0, 0.5, 1.0],                // OPTIONAL — snap to nearest enumerated value
  persist:       true,                         // write to param_center_state.yaml + reload on boot
  live:          false,                        // mark as high-rate ephemeral signal (audio, OSC stream)
  broadcastHz:   30,                           // upper bound on emissions/sec caused by this key (live params only)
  portWatch:     true,                         // include in LoRa compact_status (false = field-link sensitive)
  oscAddress:    '/marsin/param/myParam',      // canonical OSC binding — always wired
  sharedFnName:  'myParam',                    // WASM export name patterns import to consume the value
}
```

### Defaults that get auto-applied

You can omit any of these — they fall through to `REGISTRY_DEFAULTS` (see `marsin_engine/lib/param_center.js:73-87`):

```javascript
{ live: false, broadcastHz: 30, persist: false, portWatch: true }
```

Reach for **non-defaults** when:

| Field | Set to | When |
|---|---|---|
| `persist: true` | always | operator-facing knobs that must survive a restart (speed/size/colors) |
| `persist: false` | live signals | audio levels, beats, anything regenerated every frame from an external source |
| `live: true`     | live signals | flags the param as high-rate; required for `broadcastHz` to kick in |
| `broadcastHz: 15` | live signals | rate-limits the WS fan-out; protects CaptainPad / PortWatch from per-packet floods |
| `portWatch: false` | live signals | excludes from LoRa compact frame so PortWatch isn't drowned |

The shipped audio pair is the canonical reference for the *two distinct shapes* a new param tends to take:

- `audioReactivity` — an **operator-tuned gain**: persisted, default broadcast rate, visible on LoRa, no `live` flag.
- `stemsVocals` — a **live OSC stream**: not persisted, throttled broadcast, hidden from LoRa.

Look at `marsin_engine/lib/param_center.js:56-79` for the live registry entries to crib from.

### Naming rules

- `key` → camelCase, must be unique across the registry.
- `sharedFnName` → patterns import it under this name; convention is to match `key`.
- `oscAddress` → namespaced under `/marsin/...`. Reuse the same address only with explicit object-form bindings (`docs/24 §6.5`).

---

## 2. Wire up the persistence / broadcast surface

**You do not write any new code here.** The CPC already does the right thing because of the `onChange` hook installed by `api_server.js`. Specifically:

- `GET /param-center` reflects the new key on the next request.
- `POST /param-center` accepts `{ "myParam": 0.7 }` and routes through `paramCenter.set()`.
- WS `sharedParams` broadcast includes the key automatically.
- WS `setSharedParam` accepts the key.
- The OSC listener picks up the canonical `oscAddress` from the schema on next boot — no listener code change needed.
- Persistence (if `persist: true`) is debounced through `paramCenter.hasPersistentDirty()` → `save()`.

If you're adding the param mid-session, you must **restart the engine**. The registry is read once at boot.

---

## 3. Add the param to CaptainPad

The deck/mixer GLOBALS strip lives in `CaptainPad/components/CPCControls.tsx`. Every fader is a `MiniFader` bound to `params.<key>` via `useSharedParamValues()` (see `CaptainPad/hooks/useEngineState.ts:204-215`).

### 3a. Add the default + slider

Two edits in `CPCControls.tsx`:

```tsx
const defaultParams = useMemo(() => ({
  speed: 0.5,
  // ...existing...
  myParam: 0.5,            // 1) add default so first paint isn't undefined
}), []);

// 2) drop in a slider where it belongs in the strip
<View style={{ flex: 1, maxWidth: isPortrait ? 90 : 140 }}>
  <MiniFader
    label="MYP"
    value={params.myParam ?? 0.5}
    onChange={(v) => update('myParam', v)}
  />
</View>
```

The `update()` helper in `CPCControls.tsx` already POSTs to `/param-center` and lets the engine's `sharedParams` broadcast paint every other connected client. **No optimistic local state** is needed — the broadcast round-trip is sub-second on Wi-Fi and an optimistic shadow only introduces UI flicker when source-lock rejects a write.

### 3b. For HSV params

Use the swatch-and-modal pattern from `colorPalette1` / `colorPalette2` in `CPCControls.tsx`. The CPC accepts `{ h, s, v }` objects directly via `POST /param-center`; for per-component animation use `WS setSharedParamHsvField` to avoid race-conditions between three concurrent writes.

### 3c. For live (audio / OSC-driven) params

Operators rarely need to *write* a live param from CaptainPad — they need to *see* it flow in. Three options:

1. **Status pill only** (already shipped for OSC overall — see `CaptainPad/components/OscStatusPill.tsx`). Read state with `useOscStatus()`.
2. **Read-only meter** — see the `StemsMeter` subcomponent in `CaptainPad/components/CPCControls.tsx` for the canonical pattern (raw level + effective-after-gain in a single track). Keep the param key in `defaultParams`.
3. **No UI** — fine for purely-pattern-consumed signals; they still show up in `GET /param-center` for debugging.

If you add a UI control for a live param, set the source explicitly via `lastSource: 'ipad'` so source-lock + OSC source-lock leases behave correctly (handled automatically by the existing `update()` path).

---

## 4. Wire up OSC (optional, only beyond canonical)

The registry's `oscAddress` is wired automatically. If you need to map a *different* address (e.g., a TouchOSC `/1/fader1`) on top of the canonical one, add a `bindings:` entry under the `osc:` block in `marsin_engine/config.yaml`:

```yaml
osc:
  bindings:
    - address: /1/fader1
      key: myParam
```

Object-form bindings (XY pads, multi-arg packets) and the full mapping spec live in `docs/24_osc_integration.md §6`.

---

## 5. Expose the param to patterns

A param only affects the LEDs if a pattern imports its `sharedFnName`:

```javascript
// In your .js pattern file
export var myParam   // shared global — populated by CPC every frame

export function render(index) {
  // use myParam ...
}
```

The engine's WASM injection (`rebuildControlMap()`) sees `myParam` in the pattern's exports and wires it. The `sharedFnName` you set in the registry **must** match the pattern's export name.

For per-scene defaults / overrides, set the value in `simulation/scenes/<scene>/patches.yaml` (`shared_params:` block, if present) — patches are applied at scene-load and behave like any other CPC writer (source `'scene'`).

---

## 6. PortWatch (LoRa) parity

PortWatch mirrors CPC fields over LoRa via the engine's `compact_status` frame. The compact frame is **schema-filtered** by `portWatch: true` — fields with `portWatch: false` never go over the air. (Refer to `docs/24 §11.3` for the bridge requirement.)

- **Operator-facing scalar** → leave `portWatch` at default `true`.
- **High-rate live signal** → set `portWatch: false` explicitly. Audio params are the canonical example.
- **HSV palette** → leave `true` for v1; the bridge encodes it compactly.

If you change `portWatch` for an existing param, the PortWatch bridge will re-fetch the schema on its next engine-reconnect — no client release required.

---

## 7. Tests

Add at minimum a registry-shape test to `marsin_engine/tests/param_center.test.js`:

```javascript
test('myParam is registered with the expected schema', () => {
  const pc = new ParamCenter(null);
  const schema = pc.getSchema();
  const entry = schema.find(s => s.key === 'myParam');
  assert.ok(entry, 'myParam missing from schema');
  assert.strictEqual(entry.persist, true);
  assert.strictEqual(entry.portWatch, true);
  assert.deepStrictEqual(entry.range, [0, 1]);
});

test('myParam clamps to [0,1] and broadcasts via onChange', () => {
  const pc = new ParamCenter(null);
  let fired = [];
  pc.onChange = (keys) => fired.push(keys);

  const r = pc.set('myParam', 1.7, 'api');
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(pc.getValue('myParam'), 1.0);
  assert.deepStrictEqual(fired, [['myParam']]);
});
```

For HSV params test each component via `setHsvField()`. For live params assert `hasPersistentDirty()` stays `false` and `broadcastHz` is respected (see `tests/param_center.test.js` for the existing `audioLevel` patterns).

Run:

```bash
cd marsin_engine
node --test tests/param_center.test.js
```

---

## 8. Verify end-to-end

Run through this checklist before merging:

1. **Schema endpoint** — `curl http://<engine>:3000/param-center` shows the key with the correct value and metadata.
2. **HTTP write** — `curl -X POST http://<engine>:3000/param-center -H 'content-type: application/json' -d '{"myParam":0.7}'` returns the new revision, and a fresh `GET` shows the updated value with `"lastSource":"api"`.
3. **WS broadcast** — open CaptainPad, move the slider, and confirm a second CaptainPad instance (or the dev tools' WS panel) sees `sharedParams` with the new value.
4. **Persistence** — if `persist: true`, restart the engine and confirm the value survives (look in `param_center_state.yaml`).
5. **OSC** — if `osc.enabled: true`, send to the canonical address and watch `lastSource: "osc"` in `/param-center`. The OSC pill in CaptainPad should reflect `mapped > 0`.
6. **Pattern** — load a pattern that imports `sharedFnName`, change the value, and verify LEDs respond.
7. **PortWatch** — if `portWatch: true`, confirm the key is in the bridge's compact-status payload. If `false`, confirm it is **not**.

---

## 9. Common pitfalls

- **Forgot the `withDefaults()` map** — you didn't have to. It's applied automatically in the constructor (`marsin_engine/lib/param_center.js:154`). Only the literal registry entry matters.
- **Pattern doesn't see the value** — your `sharedFnName` doesn't match the pattern's `export var` name, *or* you didn't reload the pattern after restarting the engine.
- **OSC writes are silently dropped** — check the OSC status pill in CaptainPad. `rx > 0` and `mapped == 0` means your sender's address doesn't match a binding. `dropped` is normal for unbound but otherwise-valid OSC packets (e.g., `/_samplerate` meta).
- **Live param spams the network** — you forgot `live: true`. Without that flag, `broadcastHz` is ignored and every write triggers a full broadcast.
- **Persistent live param** — `persist: true` + `live: true` is almost always a mistake. Live params change too fast for the YAML save debounce to keep up and you'll get disk churn for no operator benefit.
- **HSV slider feels janky** — you're round-tripping through `set()` with the full HSV object instead of `setHsvField()`. Use the field-level write to avoid stomping concurrent component changes.

---

## 10. Decommissioning a param

Reverse-order:

1. Remove the UI from CaptainPad (sliders, pickers, pills).
2. Remove pattern usages of `sharedFnName`.
3. Remove the registry entry.
4. Remove any custom OSC bindings in `config.yaml`.
5. (If `persist: true`) the stale entry in `param_center_state.yaml` is ignored on next boot; you can leave it or delete it.
6. Drop the tests that referenced the key.

Keep the registry as the canonical map — every other surface is downstream.
