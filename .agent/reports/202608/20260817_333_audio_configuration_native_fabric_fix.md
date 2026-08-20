# Audio configuration native Fabric fix

## Outcome

Sina physically accepted the Audio page as **GOOD** on the native iPad in Edit
mode. The Audio tab, live LOW/MID/HIGH monitor, OSC BPM, input gain, BPM sync,
Companion launcher, Settings disclosure, and configuration controls are present
and reachable. Web behavior remains healthy. No service, launcher, port,
live-output, or git operation was performed.

## Proven root cause

The route and live data were never missing. Each meter cell lived in an
auto-height, wrapped native row, while both branches of `SignalColumn` returned
an inner `View` with `flex: 1`. Fabric/Yoga could not derive intrinsic vertical
size for that flex child: the exact native layout model produced a zero-height
meter grid and placed the following configuration body at the same top edge.
The trace canvas could still paint the monitor, making the failure look like a
healthy monitor followed by a blank page while the lower subtree was overlapped
or suppressed from normal flow.

Changing the two `SignalColumn` roots to `width: '100%'` preserves horizontal
fill without flex-growing inside an auto-height parent. The same Yoga model now
produces a 106 px meter row and places the configuration body 106 px below it.
The physical iPad acceptance after this change closes the source-to-device
causal chain. The earlier missing-tab/Performance-filter diagnosis was false;
Audio remains Edit-only by policy.

## Implementation

- `CaptainPad/app/(tabs)/audio.tsx`: removes the native flex trap; keeps one
  scroll owner; exposes stable native probes; renders loading/API/authority
  failures visibly; serializes writes; and reconciles gain, device, reset,
  broadcast, and reconnect truth, including partial reset success.
- `CaptainPad/components/audio/AudioTraceCanvas.tsx`: bounds trace history and
  publishes display paths at a stable cadence to avoid meter-driven churn.
- `CaptainPad/components/audio/audio_configuration_logic.ts`
- `CaptainPad/components/audio/audio_configuration_logic.test.ts`
- `CaptainPad/components/audio/audio_configuration_yoga.test.ts`
- `CaptainPad/components/audio/audio_configuration_wiring.test.ts`
- `CaptainPad/components/audio/audio_native_route.test.ts`
- `CaptainPad/components/audio/audio_trace_logic.ts`
- `CaptainPad/components/audio/audio_trace_logic.test.ts`
- `CaptainPad/utils/captainpad_tab_policy.test.ts`

No Live Touch, Timeline, `marsin_engine/lib/api_server.js`, deployment, or live
runtime file was changed.

## Visual evidence

Physical native BEFORE, copied from the operator-provided capture:

- `~/tmp/audio_configuration_ui_debug/screenshots/before_native_ipad_edit_monitor_only.png`

It shows the mounted Audio route and updating monitor with the entire lower
configuration body absent. Sina then inspected the corrected native iPad page
and explicitly accepted it as GOOD. No separate physical AFTER file was
supplied, so this report does not invent one.

Supporting visually inspected web captures:

- `~/tmp/audio_configuration_ui_debug/screenshots/after_ipad_landscape_1180x820.png`
- `~/tmp/audio_configuration_ui_debug/screenshots/after_ipad_landscape_1180x820_settings.png`
- `~/tmp/audio_configuration_ui_debug/screenshots/after_web_desktop_1440x900.png`
- `~/tmp/audio_configuration_ui_debug/screenshots/after_web_desktop_1440x900_settings.png`
- Constrained 568x720 and 430x932, closed/open Settings: corresponding
  `after_constrained_*` files in the same directory.
- `before_metrics.json`, `after_metrics.json`, and `after_functional.json` in
  the same directory.

The web artifacts support responsive behavior but are not presented as native
proof. Native proof is the exact Yoga regression, successful iOS Hermes export,
bundle probes, independent review, and Sina's physical acceptance.

## Validation matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Physical native iPad, Edit | **PASS** | Sina: corrected Audio page is GOOD |
| Independent read-only review | **PASS** | No Audio-owned finding or blocker |
| Focused Audio/native | **PASS** | 6 files, 59/59 tests |
| Full CaptainPad | **PASS** | 139 files; 2510 pass, 6 skipped, 0 fail |
| Native Fabric/Yoga | **PASS** | 4/4; broken 0 px vs fixed 106 px flow pinned |
| Touched-file ESLint | **PASS** | 0 errors, 0 warnings |
| Full CaptainPad lint | **PASS with unrelated warnings** | 0 errors; 10 pre-existing warnings outside Audio |
| Full TypeScript | **FAIL, unrelated** | two existing Deck-test diagnostics; no Audio diagnostics |
| Engine audio config/API | **PASS** | 63/63 tests |
| iOS offline export | **PASS** | 1951 modules; 6.36 MB Hermes bundle |
| iOS bundle probes | **PASS** | route, five body probes, pending/error strings present |
| Web functional readback | **PASS** | writes, readbacks, broadcasts, reconnect, rejection |

iOS export: `~/tmp/audio_configuration_ui_debug/ios_export_after/`. The bundle
contains `audio-analysis-screen`, `audio-primary-controls`, `audio-bpm-sync`,
`audio-companion-card`, `audio-settings-card`, `CHECKING EDIT AUTHORITY`, and
`AUDIO CONFIG UNAVAILABLE`.

## Remaining risks

- The physical AFTER acceptance is operator-observed but has no retained image
  artifact. A future regression audit should capture one at the same geometry.
- Full TypeScript remains red on two unrelated concurrent Deck test typing
  errors. Audio itself adds no compiler diagnostic.
- The Settings collapsed preference remains intentionally persisted. Its card
  is always mounted, and the accepted native smoke confirmed it is reachable.

## Physical-iPad smoke for future builds

1. Fully close and reopen CaptainPad so the device loads the current bundle.
2. Stay in Edit mode and open Audio.
3. Confirm AUDIO, status chips, LOW/MID/HIGH traces, OSC BPM, and INPUT GAIN.
4. Scroll once; confirm BPM to SPEED SYNC, AUDIO COMPANION, and SETTINGS appear
   below the monitor with no blank region, overlap, or scroll trap.
5. Expand SETTINGS; change input gain and capture device, then reopen Audio and
   confirm engine readback matches.
6. Force a config/API failure in an isolated build; confirm the bounded
   `AUDIO CONFIG UNAVAILABLE` panel and RETRY action, never an empty body.
7. Enter Performance mode; confirm Audio remains absent per existing policy,
   then return to Edit and confirm it remounts intact.
