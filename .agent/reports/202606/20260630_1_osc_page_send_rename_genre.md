# 20260630_1 — OSC OUT page: scroll + per-signal send toggle + path rename; genre as integer

**Branch:** `feat/audio_analysis_2` (PR #39)
**Date:** 2026-06-30

## Asks (operator)
1. The OSC OUT page list needs to **scroll**.
2. Add a **checkbox per signal** to send / not-send its OSC.
3. **Allow renaming the OSC path** (do NOT derive the CPC key — just rename).
4. Q: *if renamed, will the CPC pick up the new key dynamically?*
5. Q: *the genre is not sent correctly — do we have a solution for that in OSC?*

## Done

### Scroll (CSS only)
`.osc-table-wrap` is now its own scroll container (`flex:1; overflow:auto`);
the `thead` stays sticky at its top. Header + rate control stay put while a long
signal list scrolls.

### Per-signal SEND toggle
- New **ON** column with a checkbox per row. Unticking mutes that address on the
  wire (`sendOsc` early-returns for a disabled address; its reported rate decays
  to 0 — honest, not frozen).
- State keyed by **wire address** (covers designed + BPM + derived emits
  uniformly), held in `oscDisabled` and persisted into `design.osc.disabled`
  (Export config writes it through, same as the OSC rate).
- WS: `setOscSend { address, enabled }`. `validateCompanionConfig` validates/
  normalizes `osc.disabled` (array of absolute OSC addresses; deduped).
- Muted rows dim (the checkbox cell stays full-opacity).

### Rename the OSC path
- `osc_out` op gained an OPTIONAL `address` param (no default → absent keeps the
  `{name}`-only shape; the address stays DERIVED). When present it must be an
  absolute OSC path; **the cpcKey is still `slug(name)` — only the wire path
  changes** (exactly "rename, don't derive the cpcKey").
- `resolveOscOut(name, addressOverride)` honors the override for DYNAMIC outputs
  and IGNORES it for CURATED built-ins (their canonical engine path is locked).
- Only **operator-added (dynamic)** rows are editable in the UI (inline input);
  curated / derived / BPM rows render locked (🔒) plain text. Edit commits on
  Enter/blur, Esc reverts; the table won't rebuild while a field has focus.
- WS: `setOscAddress { id, address }` (empty ⇒ revert to derived). Re-pushes the
  manifest; carries any "muted" flag across the rename.
- Collision safety: `validateCompanionConfig` now also rejects two outputs
  resolving to the **same address** (an override can now clash); the live rename
  handler rejects a clash too.

### Q4 — does the CPC follow a rename dynamically?
**Yes, for operator-added (dynamic) signals.** On rename the companion re-POSTs
the manifest with the SAME cpcKey at the NEW address; the engine binds the new
path → same cpcKey and (new) **removes the stale old binding**
(`api_server.js` manifest route). CaptainPad + modulators keep working — the
cpcKey never changed. **No, for built-ins** (curated mic bands + the derived /
BPM emits): the engine binds those at FIXED canonical addresses compiled into
`audio_signals.js`, and the manifest deliberately excludes them — so their path
is locked (read-only) in the UI.

### Q5 — genre over OSC
Genre WAS transiting fine (e2e showed `audioGenre=2.0` reaching the engine CPC).
It is a **categorical class index**, so the real fix is to stop treating it as a
continuous float: the index-valued derived keys (`audioGenre`, `audioNote`,
`audioStructure`) now ship as **rounded INTEGER-typed OSC args**
(`INTEGER_OSC_KEYS` in `companion_server.js`). A class can never arrive as 2.4
nor be interpolated between classes. The engine's `OscListener` already accepts
integer-typed args, so it lands as the exact index.

### Cleanup
Removed the now-false "ENGINE-INTERNAL DERIVED / the engine has its own audio
intelligence" panel (HTML + JS + CSS) — since the sole-analyzer move the
companion emits every derived signal, so that panel was dead and misleading.

## Validation
- Full engine suite **1247/1247** green (added 6 designer tests: address-override
  validation, dynamic vs curated resolve, address-collision, disabled persist).
- Engine `--dry-run`: clean (exit 0).
- Companion boot + WS drive: added a dynamic signal → `editable:true`; renamed
  its path to `/marsin/custom/myrename` (cpcKey stayed `low_4gno`); muted it →
  `enabled:false`. Integer OSC round-trip verified (genre→integer 2, micLow→
  float). Screenshot of the OSC page (ON checkboxes, locked 🔒 built-ins, the
  editable renamed dynamic row, scroll, hint): `~/tmp/osc_shots/osc_page.png`.
- Live analyzer couldn't run in this container (ffmpeg rejects `fragment_size`),
  so packet flow wasn't re-exercised here; the accounting + WS paths were driven
  directly instead.

## Note for the operator
Send toggles + path renames live in `design` (in memory) like the OSC rate —
hit **Export config** to persist them to `companion_config.yaml`.
