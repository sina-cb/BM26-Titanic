# Hue Shifter Implementation Plan (global + per-channel) — recon a47e25

RGBWAU buffers: per-channel `channelBuffer` Uint8Array 0-255 interleaved [R,G,B,W,A,U]
(pattern_mixer.js:243; readback engine.js:626-633). Final output = model.pixels floats
0-1 (.r/.g/.b/.w/.a/.u). Global effects run on model.pixels in engine.js:636-659:
applyPixels → applyMacros → applyGroupFixedColors → intensity/blackout (last). NO existing
hue helper anywhere. RULE for both: rotate RGB ONLY, leave W/A/UV untouched (no hue concept;
must not dim mission-critical exterior whites). YIQ rotation matrix (precompute cos/sin once
per frame; 9 mults/pixel). Gate on non-zero hue → zero cost at default.

## Request 2: PER-CHANNEL hue (build BEFORE global; establishes validateHue + helper)
Engine writer (api_server.js + pattern_mixer.js + pattern_channel.js):
- pattern_channel.js: add `hue=0` (normalize ((h%360)+360)%360) near soloSafe (:68).
- pattern_mixer.js: module helper `applyHueShift6chU8(buf,pixelCount,degrees)` (RGB only,
  clamp 0-255, precompute matrix). Apply in composite loop AFTER renderInto, BEFORE blend
  (~:2152-2153) gated `if(channel.hue)`; also in vis pre-pass (~:1979-1981) so meter/vis match;
  deck pre-pass (~:1999) for deck hue (deckChannel is a PatternChannel → free).
- api_server.js: validateHue(raw) (model on validateFader :196-213; finite→400, normalize).
  Add hue block to PATCH /mixer/channels/:id (~:3767-3783 area) + PATCH /deck/channel
  (~:4613-4627). Serialize hue in ALL FOUR serializers (api_server serializeMixerState :1981 +
  legacy serializeChannel :1884; state_manager serializeChannel :41 + saveMixerState overlay
  :300) + restore path (~:1598-1620 after soloSafe).
UI (mixer.tsx ChannelStrip + channelExtrasApi.ts): HUE row after the CAP row (~:522), clone
the CAP HorizontalFader block; handler useCallback([]) reading channelsRef (memo contract,
clone handleFaderMaxChange :1334-1347): optimistic+PATCH+revert/Alert. setChannelHue(id,hue,
{deck}) in channelExtrasApi (clone setChannelFaderMax :129-151).

## Request 1: GLOBAL hue (NOT a GEM slot — it's a continuous knob + auto-rotate)
Model like blackout (first-class scalar), not a slot/preset.
Engine writer:
- NEW marsin_engine/effects/hue_shift.js: applyHueShift({pixels,degrees}) float version, RGB only,
  early-return at 0, header documents W/A/UV untouched.
- global_effects_controller.js: this.hueShift={degrees:0,autoRotateDegPerSec:0}; setHueShift(deg,
  rot) (validate finite, clamp deg [0,360), rot [-360,360]); applyHueShift(pixels,nowMs) advancing
  auto-rotate by rot*dt (wrap 360); import at top; add to getStatus(); leave hue alone in panicStop
  (document). 
- engine.js:649: call globalEffectsController.applyHueShift(model.pixels, now) BETWEEN applyMacros
  and applyGroupFixedColors (so color-locks + blackout stay authoritative).
- api_server.js: POST /global-effect-hue {degrees, autoRotateDegPerSec?} mirroring blackout route
  (:2889-2911): validate 400, setHueShift, persist globalsState.hueShift (saveGlobalsState),
  broadcast {type:'globalHueShift',hueShift}. state_manager loadGlobalsState default + restore.
UI: GlobalEffectMacros.tsx — NEW section below the slot grid (~after :494) with two HorizontalFaders
(hue 0-360 + auto-rotate speed), like GlobalParams.tsx:145-164 HUE slider; throttled POST; reflect
globalHueShift WS into state.

## Compose / warnings
- per-channel hue (pre-blend on channelBuffer) + global hue (post-composite on model.pixels) STACK
  additively per channel — document. Both RGB-only. effFader orthogonal (level not chroma). color
  field is metadata (no conflict). No channel invert field exists.
- Global hue before group-fixed-colors + intensity/blackout → locks & safety unaffected.

## Build order & ownership (mixer.tsx + api_server.js + pattern_mixer.js are SERIAL)
1. Request 3 mixer readability (PlaylistPanel.tsx) — DONE/in-flight, standalone.
2. Per-channel hue ENGINE (after cue-to-deck frees api_server/pattern_mixer) — establishes helper.
3. Global hue ENGINE (reuses helper) — sequential after #2 on api_server.js + state_manager.
   (WS-A global + WS-B per-channel BOTH edit api_server.js + state_manager → serialize: one engine
   writer does both, or sequential commits.)
4. Hue UI (after ops-UI frees mixer.tsx): per-channel HUE row in mixer.tsx + global section in
   GlobalEffectMacros.tsx + channelExtrasApi.ts. Land into the decluttered strip (after #1).
Tests: unit (rotate red→120/240 correct, W/A/U unchanged, no-op at 0, validateHue NaN→400 +
normalize 370→10, auto-rotate advances), serialize round-trip + restore, full-stack smoke capturing
the sim color rotating.
