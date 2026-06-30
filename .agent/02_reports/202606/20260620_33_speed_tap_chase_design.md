# Round-2 Cluster: Per-Channel Phase Clock — #3 Speed · #4 Tap-Tempo · #11 Chase/Offset (design)

ONE engine writer builds the shared phase clock; UI after. Build order: #3 (establishes clock) → #11 (rides) → #4 (rides + 1 global).

## Grounding (KEY)
VM takes ABSOLUTE per-handle time: wasmHost.beginFrame(handle, elapsedSeconds) (wasm_host.js:102). Engine ALREADY
accumulates a global scaled phase (engine.js:518-548 "patternClockSeconds", scale each wall dt by global mult →
patterns never see the knob). One `elapsed` fans UNCHANGED to every channel (pattern_mixer.js:1979 deck / 1981
overlays / 1990 inactive sibling) via PatternChannel.beginFrame (pattern_channel.js:121). → We give each channel
its OWN accumulated phase from that same global elapsed delta. MUST accumulate (not scale dt) or absolute-time
patterns JUMP on speed change.

## Phase clock (pattern_channel.js)
New per-channel: speed (default 1.0, clamp [0.05,8]); phaseOffsetMs (default 0, clamp [-10000,10000]);
followsTempo (bool, default false). TRANSIENT (never serialized): _phaseSeconds=0, _lastPhaseElapsed=null.
Rewrite beginFrame(wasmHost, elapsed, force, effectiveSpeed=1): dt = elapsed - _lastPhaseElapsed (first frame 0;
guard dt<0→0); _lastPhaseElapsed=elapsed; _phaseSeconds += dt*effectiveSpeed; phase = _phaseSeconds +
phaseOffsetMs/1000; wasmHost.beginFrame(handle, phase). Never jumps (accumulator continuous across speed change;
offset change = intended one-frame step). NO reset on handle swap (continuity fine). NO modulo (wrap would glitch
absolute-time patterns; f64 fine for a 12h show).

## Mixer hook (pattern_mixer.js:1971 beginFrame)
Read tempoMultiplier once/frame. Pass _effectiveSpeed(channel) to each of the 3 beginFrame call sites; the
inactive deck sibling MUST get the DECK's effectiveSpeed (keep ping-pong time-sync contract :1983-1991).
_effectiveSpeed(ch) = clamp(ch.speed * (ch.followsTempo? _tempoMultiplier:1), 0.05, 8) — O(1), no alloc, near _effFader.

## #3 Speed
PATCH {speed} both channel handlers (mirror hue block: api_server ~3996 mixer / ~4847 deck) + validateSpeed
(next to validateFader :196/validateHue :227; non-finite→400, clamp [0.05,8]). Serialize in ALL 4: state_manager
serializeChannel (~:57 after hue), api_server serializeChannel (~:1924), serializeMixerState inline (~:2028),
buildChannelFromSaved restore (~:1650), default 1.0.

## #4 Tap-tempo (manual only; audio BPM out-of-scope)
Client computes BPM from tap intervals. Mixer: tempoBpm=null, _tempoMultiplier=1; setTempoBpm(bpm)→
_tempoMultiplier=clamp(bpm/120,0.05,8) (120 BPM=1×). POST /mixer/tempo {bpm} (near PATCH /mixer ~3304): validate
finite [20,400]→else 400; setTempoBpm; saveAllState; broadcast. Affects ONLY followsTempo channels (opt-in;
exterior immune unless opted). Serialize tempoBpm as a global (serializeMixerState by master); followsTempo
per-channel (4 serializers + PATCH {followsTempo} `!!`).

## #11 Chase/offset
phaseOffsetMs constant added in beginFrame (already above). Composes with speed (offset in phase-time). validate
PhaseOffsetMs (finite, clamp ±10000). PATCH + 4 serializers (default 0). Same-pattern channels w/ offsets
{0,250,500}ms → chase/ripple.

## Composition / orthogonality (CONFIRMED)
effectiveSpeed = clamp(speed*(followsTempo?tempoMult:1),0.05,8); phase = _phaseSeconds + phaseOffsetMs/1000;
_phaseSeconds += globalDt*effectiveSpeed (globalDt already global-scaled by engine.js — do NOT re-apply global).
Orthogonal to fader/faderMax/group/solo/bump (level), hue (chroma), viewSelection (spatial). TRANSITIONS RAMP
channel.fader ONLY (pattern_mixer.js:1915,1921) — never time. Disjoint.

## UI (after engine)
mixer.tsx ChannelStrip: SPEED + OFFSET HorizontalFader rows after HUE row (~:589), map domain at boundary like
HUE (/360); FOLLOW TEMPO toggle. Handlers useCallback([]) (mirror handleHueChange :1572), optimistic+reconcile+
fail-loud. DeckTopBar.tsx (~:212) TAP TEMPO button (client tap math → postTapTempo(bpm)). channelExtrasApi.ts:
setChannelSpeed/PhaseOffset/FollowsTempo + postTapTempo. MixerChannel type += speed/phaseOffsetMs/followsTempo.

## Tests
Unit: phase accumulates monotonic; speed change no jump (phase@0.3 == phase@0.2 + 0.1*4); offset = constant diff;
tempo 60→0.5× on followers only; clamp speed*tempo→8; validators 400/clamp; serialize round-trip + missing→
defaults; orthogonality (transition ramps fader, phase unaffected). HIL: 2 ch same pattern speed 1× vs 2× vis
diverge; offsets staggered; POST /mixer/tempo 60 halves followers; bad bpm/speed→400.

## Risks
speed 0/neg → 0.05 floor (frozen=broken, anti-silent-failure). phase overflow: f64 fine, NO modulo (would glitch).
static patterns: no-op (fine). inactive deck sibling: share deck effectiveSpeed (ping-pong sync). _phaseSeconds
TRANSIENT never serialized. global-speed double-count: per-channel multiplies already-global-scaled dt — don't
re-read global. Citations: wasm_host.js:102; engine.js:518-548; pattern_mixer.js:1979-1991/1915/1921/1064;
pattern_channel.js:2/81/121; api_server.js:196/227/1650/1886/1978/3906/4790; state_manager.js:15/57;
mixer.tsx:589/977/1535; HorizontalFader.tsx:4; DeckTopBar.tsx:212.
