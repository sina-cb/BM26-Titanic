# Deck Dynamic View Overrides — Design (read-only recon)

Layered, view-scoped overlay decks: each overlay = own VIEW + own PLAYLIST + own full deck
surface, composited over the main deck, stacked/reorderable, blend-selectable, accent-colored.
ONE engine writer (pattern_mixer.js + api_server.js serial), UI after. REUSE the overlay-channel +
blend + view-mask machinery — do NOT build a deck-local stack.

## Engine model — REUSE PatternChannel + a deck-overlay array
A deck overlay IS a PatternChannel exactly like a mixer overlay (pattern_channel.js:2 has id, mode,
fader, enabled, viewSelection, faderMax, color, playlist, hue, locked). Add `this.deckOverlays = []`
on PatternMixer beside `deckChannel`/`mixerChannels` (pattern_mixer.js:215,663). Reuse `addMixerChannel`
shape via a sibling `addDeckOverlay(config)` (cap-checked like :764, mask-compiled via
recompileChannelMask :773). Fields per layer: id, viewSelection, playlist, mode(blendMode), enabled,
fader, faderMax, color(=accent), order(=array index, NO numeric field — mirror reorder semantics :826).
The main deck stays `deckChannel` (bottom layer). Do NOT route overlays through `mixerChannels` — that
stack feeds `mixerBuffer` (the OTHER side of the deck/mixer crossfade, renderAll6ch:2578) and would
break deck/mixer isolation (the split's whole point, :2580).

## Compositing — extend renderAll6ch step 2 (deckBuffer is the accumulator)
After the deck channel renders into `deckBuffer` (PFL, :2489-2509) and BEFORE the deck-swap inactive
sibling block (:2518), insert a deck-overlay loop that mirrors the mixer loop (:2624-2700) but writes
into `deckBuffer` instead of `mixerBuffer`:
  for each overlay in deckOverlays order (bottom→top):
    effFader gate + skip-dark (:2641,2648); render into channelBuffer (:2651); hue (:2658);
    `blended = renderBlend6ch(getBlendHandle(mode), pixelCount, deckBuffer, channelBuffer, effFader)`
    (:2670); `commitBlendedLayerWithMask(deckBuffer, blended, overlay.compiledPixelMask, pixelCount)`
    (:2699) — mask via compileViewSelectionMask :30.
The resulting deckBuffer then feeds the EXISTING `lerp(deckBuffer, mixerBuffer, viewFader)` (:2702-2713)
and `applyMaster` (:2715). Composes correctly: overlays land before the deck/mixer crossfade and before
master, so both apply uniformly. NOTE: deck overlays must NOT get the PFL blackout (:2506 zeros
unselected pixels) — overlays preserve the background via commitBlendedLayerWithMask (:159), which is
exactly the never-dark behavior. So: blackout applies to deckChannel only; overlays composite-with-mask.
Perf (40fps hot path): reuse channelBuffer/blendedScratch (no new alloc); skip-dark gate (effFader<=0.001
:2648) means a disabled/zero overlay costs ~one length read; deck-swap inactive block already proves a
second composite pass into deckBuffer is fine.

## Never-dark safety (mission rule, codex P0 + 00_codex.md:8 exterior-critical)
RULE: a deck overlay may only ADD light over the main deck within its view; it can NEVER subtract from
the deck's exterior coverage. Enforced structurally by commitBlendedLayerWithMask (:159-168): unselected
pixels keep the deckChannel's value untouched; selected pixels get `blend(deck, overlay)`. With the
default screen/add/over modes (all monotone-increasing in brightness, see blend_add/blend_screen/
blend_over), the composite is >= the deck everywhere. To make it bulletproof: REFUSE the deck overlay's
viewSelection from being `{type:'all'}` inverted-to-nothing AND keep the deckChannel itself never masked.
Even a `blend_over` at fader 1 on a view only replaces WITHIN that view — the rest of the exterior stays
lit by deckChannel. No overlay can blackout the whole rig (unlike a phantom solo, :791).

## Blend modes (actual enumerated set)
VALID_CHANNEL_BLEND_MODES = { blend_screen, blend_add, blend_over } (api_server.js:169-173; scripts in
patterns/channel_blends/: blend_add.js, blend_over.js, blend_screen.js). DEFAULT = blend_screen (the
codebase default everywhere — pattern_channel.js:2, :1947, etc.; screen-style "over"). trans_* are
transient scripted transitions (patterns/transitions/), NOT steady overlay modes — exclude from the
picker (serialize coerces trans_*→blend_screen, :2451). Validate via isValidBlendMode (:179).

## Views (named registry EXISTS — reuse it)
GET /model/view-selection-options (api_server.js:3772) returns {groups[], sections[], fixtures[],
viewMasks[{name,bit,inUse}], viewMaskUnion}. The overlay view picker reuses this verbatim — same
endpoint the mixer strip already consumes (mixer.tsx:1119, api.ts:1005). viewSelection shape is
{type,target,invert} with types all|group|section|fixture|viewMask (validateViewSelection :38-92;
compile :30-94). An overlay's default view should be a REQUIRED explicit pick (see open decisions) —
NOT silently 'all' (an all-view overlay defeats the feature). Reuse mixer.tsx's view-selection modal
(:692-760) per overlay panel.

## Ordering / reorder (mirror reorderMixerChannels)
Add `reorderDeckOverlays(orderedIds)` = exact copy of reorderMixerChannels (:839-866): permutation
validation (length, dup, membership all THROW — fail loud), single atomic reassignment of the same
objects, order[0]=bottom, order[last]=top. API: POST /deck/overlays/reorder {order:[ids]} mirroring
/mixer/channels/reorder (:4555-4581) with REORDER_BAD_SET 400.

## Unique accent color (auto palette cycle)
Reuse CHANNEL_COLOR_SWATCHES (index.tsx:41-50; 8 curated high-contrast colors). On addDeckOverlay,
auto-assign `color = SWATCHES[ existing overlay count % 8 ]`, skipping any color already in use by a
sibling or the deck so adjacent layers never collide. Stored on `overlay.color` (existing field,
serialized :2476), surfaced in deck state AND used as the UI panel chrome accent. The main deck keeps
its own color; overlays must differ from it.

## API surface (new routes — all fail loud, no silent fallback)
- GET  /deck/overlays — list serialized overlays (reuse serializeChannel core).
- POST /deck/overlays { viewSelection(required, validateViewSelection), playlist|pattern, mode(default
  blend_screen, isValidBlendMode), enabled } → addDeckOverlay, auto-color, loadPlaylistEntry (:1301),
  cap check (DECK_OVERLAY_OVER_CAP 400). Mirror POST /mixer/channels (:4336-4421).
- PATCH /deck/overlays/:id { mode, fader, enabled, faderLocked, faderMax, color, hue, viewSelection } —
  clone /deck/channel PATCH (:5681-5770) but target an overlay; validateFader/isValidBlendMode/
  validateViewSelection; rejectIfWrongRole-style guard so :id can't be the deck or a mixer id.
- DELETE /deck/overlays/:id — removeDeckOverlay (mirror removeMixerChannel :778: destroy handle,
  onChannelRemoved, clearFollowers).
- POST /deck/overlays/reorder {order}.
- POST /deck/overlays/:id/playlist + /entry — reuse loadPlaylistEntryWithTransition (:1503).
WS: register a new type `deckOverlays` in TOPIC_BY_TYPE (ws_topic_routing.js:63) → TOPICS.CONTROL
(unregistered types THROW, :188) — OR fold overlays into serializeDeckState (:2405) so existing `deck`
subscribers get them free. PREFER folding into `deck` (deck tab already subscribes, index.tsx:238) +
add `overlays:[...]` to serializeDeckState; no new WS type needed.

## Persistence (deck_state.yaml)
Extend saveDeckState (state_manager.js:406-421) to write `overlays: [...]` alongside `channel:` (it
already accepts `extras` :418). Each overlay serialized with the mixer overlay shape (state_manager.js:
327-378: id..viewSelection + color + faderMax + hue, coerce trans_*→blend_screen :341). Restore in the
boot path (api_server.js:1940-1960): after restoreChannel(deck), loop deckState.overlays →
addDeckOverlay+loadPlaylistEntry, mirroring the mixer restore loop (:1953-1959). Old files without
`overlays` load to [] (documented default, no fallback).

## UI (deck tab — clean, one self-contained panel per overlay)
index.tsx renders: main deck surface (DeckTopBar + PlaylistPanel + transport + master, unchanged) then
N overlay panels below, each a SELF-CONTAINED card accent-bordered by overlay.color: its own playlist
(PlaylistPanel), transport, blend-mode selector, view picker (reuse mixer.tsx modal :692), reorder
up/down + remove. "ADD OVERLAY" affordance: pick view (required) + playlist → POST /deck/overlays.
Read overlays off the `deck` WS message (index.tsx:238 setDeckChannel → also setOverlays). Keep it
clean per the recent declutter — each panel collapses to a one-line header (accent chip + view label +
blend) and expands on tap; no cramped sprawl. New utils/api.ts helpers: fetchDeckOverlays,
addDeckOverlay, patchDeckOverlay, deleteDeckOverlay, reorderDeckOverlays (mirror channelExtrasApi.ts).

## Tests
Unit (deck_overlays.test.js): compositing order (bottom→top into deckBuffer, top wins); view masking
(commitBlendedLayerWithMask leaves unselected deck pixels untouched); each blend mode lands; reorder is
a permutation (bad set THROWS); never-dark (overlay never lowers any deck pixel below deckChannel value;
deck still lit outside overlay view); add/remove (handle freed, cap enforced, auto-color distinct);
persistence round-trip (save→restore identical). HIL: add overlay on a group view → only that group
changes, exterior stays lit; reorder mid-render no glitch; deck/mixer crossfade still works with
overlays present; blackout still wins.

## Risks & open decisions (operator must rule)
1. Transport: does each overlay run its OWN autopilot/playlist transport, or follow the main deck's
   transport? (own = independent looping per layer; follow = single clock.)
2. Same view twice: may two overlays target the SAME view, or is a view unique per overlay? (stacking
   two overlays on one view is legit for layered FX but risks confusion.)
3. Overlay cap + default view: how many overlays max (reuse maxChannels or a deck-specific cap)?, and
   does "add overlay" REQUIRE a view pick or default to a sensible view (NOT 'all')?
4. Persistence: do overlays persist across restart (like deck/mixer) or are they session-transient
   (like solo/bump)?

## Citations
pattern_mixer.js:30,159,215,215,663,748,764,778,826,839,2356,2479,2489,2506,2518,2578,2624,2641,2648,
2670,2699,2702,2715. api_server.js:38,169,179,1301,1503,1920,2400,2433,2451,3772,4336,4555,5681,5760.
state_manager.js:216,317,406. ws_topic_routing.js:63,188. pattern_channel.js:2. view_mask_constants.js:30.
index.tsx:41,238. mixer.tsx:692,1119. api.ts:1005.
