import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const wirePath = path.resolve(here, '../../../CaptainPad/live_touch/touch_control_wire.js');
const wire = fs.readFileSync(wirePath, 'utf8');
const panelPath = path.resolve(here, '../../../CaptainPad/live_touch/touch_control.html');
const panel = fs.readFileSync(panelPath, 'utf8');
const lifecyclePath = path.resolve(here, '../../../CaptainPad/live_touch/touch_control_lifecycle.js');
const lifecycleSource = fs.readFileSync(lifecyclePath, 'utf8');
const themePath = path.resolve(here, '../../../CaptainPad/live_touch/touch_control_theme.js');
const themeSource = fs.readFileSync(themePath, 'utf8');
const pixelViewsPath = path.resolve(here, '../../../CaptainPad/live_touch/touch_control_pixel_views.js');
const pixelViewsSource = fs.readFileSync(pixelViewsPath, 'utf8');
const apiServerPath = path.resolve(here, '../../lib/api_server.js');
const apiServerSource = fs.readFileSync(apiServerPath, 'utf8');

test('Live Touch routes patterns and controls to its isolated layer', () => {
  assert.match(wire, /['"]\/layers\/live_touch\/pattern['"]/);
  assert.match(wire, /['"]\/layers\/live_touch\/control['"]/);
  assert.doesNotMatch(wire, /['"]\/pattern['"]/);
  assert.doesNotMatch(wire, /['"]\/control['"]/);
});

test('native ARM reads bypass WKWebView cache on both sides of the request', () => {
  const requestJson = wire.match(/function requestJson\(method, path,[\s\S]*?\n  \}/);
  assert.ok(requestJson, 'Live Touch requestJson must exist');
  assert.match(requestJson[0], /if \(method === 'GET'\) opts\.cache = 'no-store'/,
    'every dynamic engine GET must explicitly bypass the native WebView cache');

  const pixelRoute = apiServerSource.match(
    /req\.method === 'GET' && req\.url === '\/model\/pixel-layout'[\s\S]*?res\.end\(JSON\.stringify\(\{[\s\S]*?pixels: out,[\s\S]*?\}\)\);/,
  );
  assert.ok(pixelRoute, 'engine pixel-layout route must exist');
  assert.match(pixelRoute[0], /'Cache-Control': 'no-store'/,
    'the topology response must not survive into another native session');

  const layerRoute = apiServerSource.match(
    /req\.method === 'GET' && req\.url === '\/layers\/state'[\s\S]*?res\.end\(JSON\.stringify\(buildLayerSettingsPayload\(\)\)\);/,
  );
  assert.ok(layerRoute, 'engine layer-state route must exist');
  assert.match(layerRoute[0], /'Cache-Control': 'no-store'/,
    'the layer schema/state response must not survive into another native session');
});

test('the pattern picker offers BACKGROUNDS (ambient playlist) and INSTRUMENTS, isolation intact', () => {
  // docs/70 §3.2 W2 correction: the picker is no longer the flat 3-option
  // select — it is BACKGROUNDS (the `ambient` playlist's blessed entries,
  // runtime-populated) + INSTRUMENTS (128-130, unchanged). The old pin
  // asserting exactly ['128','129','130'] on the WHOLE select is retired on
  // purpose; the INSTRUMENTS half of that guarantee is re-asserted below,
  // scoped to its own optgroup, alongside the new BACKGROUNDS contract.
  const selectBlock = panel.match(/<select class="select" id="patternSel">([\s\S]*?)<\/select>/);
  assert.ok(selectBlock, 'Live Touch is missing its pattern selector');
  const selectMarkup = selectBlock[1];

  // INSTRUMENTS optgroup: regression guard — same 3 patterns, same map.
  const instrumentsBlock = selectMarkup.match(/<optgroup label="INSTRUMENTS">([\s\S]*?)<\/optgroup>/);
  assert.ok(instrumentsBlock, 'Live Touch pattern selector is missing its INSTRUMENTS optgroup');
  const optionIds = [...instrumentsBlock[1].matchAll(/<option value="(\d+)"/g)].map(match => match[1]);
  const mapBlock = wire.match(/var PATTERN_FILES = \{([\s\S]*?)\n  \};/);
  assert.ok(mapBlock, 'Live Touch wire is missing PATTERN_FILES');
  const mappedIds = [...mapBlock[1].matchAll(/'(\d+)':/g)].map(match => match[1]);
  assert.deepEqual(optionIds.sort(), mappedIds.sort());
  assert.deepEqual(mappedIds.sort(), ['128', '129', '130']);

  // BACKGROUNDS optgroup: an empty, runtime-populated container — the panel
  // fills it from the `ambient` playlist only (D4), never a bare pattern list.
  assert.match(selectMarkup, /<optgroup label="BACKGROUNDS" id="patternBackgroundGroup">/,
    'Live Touch pattern selector is missing its BACKGROUNDS optgroup');

  // The wire reads exactly the `ambient` playlist through the existing
  // engine-level /playlists route — the one entry-resolution read the
  // isolation rule permits alongside the /layers/live_touch/* writes.
  assert.match(wire, /var BACKGROUND_PLAYLIST_NAME = 'ambient';/);
  assert.match(wire, /req\('GET', '\/playlists\/' \+ BACKGROUND_PLAYLIST_NAME\)/);

  // Staging a BACKGROUND sends the full entry form; staging an INSTRUMENT
  // keeps the bare {pattern} form exactly as before this wave (regression).
  assert.match(wire,
    /body: \{ pattern: opt\.dataset\.pattern, playlist: opt\.dataset\.playlist, entryId: opt\.dataset\.entryId \}/);
  assert.match(wire, /return \{ pattern: name, isBackground: false, body: \{ pattern: name \} \};/);

  // Parameters are never rendered for a background: both the topbar change
  // handler and the ARM stage step skip refreshLiveExports() when the
  // staged selection is a background (the ONLY way local controls are
  // learned), so hiding is free and total — never a suppression flag.
  const skipGuards = [...wire.matchAll(/if \(staged\.isBackground\) \{[\s\S]*?state\.exports = \{\};[\s\S]*?return null;[\s\S]*?\}/g)];
  assert.equal(skipGuards.length, 2,
    'both background paths must clear stale exports before skipping refreshLiveExports()');
  assert.doesNotMatch(wire, /hideParams|suppressParams|paramsHidden/i,
    'hiding must fall out of never fetching exports, not a dedicated hide flag');

  // Isolation rule, restated for the wider contract: /playlists is read-only
  // entry resolution, never a second write surface next to /layers/live_touch/*.
  assert.doesNotMatch(wire, /req\('(?:POST|PUT|PATCH|DELETE)', '\/playlists/);
  assert.doesNotMatch(wire, /write\('(?:POST|PUT|PATCH|DELETE)', '\/playlists/);
});

test('passive retained-pattern mismatch is quiet while explicit staging stays strict', () => {
  const sync = wire.match(/function syncPatternSelection\(pattern\) \{[\s\S]*?\n  \}/);
  assert.ok(sync, 'Live Touch pattern selection synchronizer is missing');
  assert.doesNotMatch(sync[0], /\bfail\(/,
    'a stale retained channel or a catalog race must not create an operator error');
  assert.match(wire,
    /if \(!syncPatternSelection\(response\.pattern\)\) \{\s*throw new Error\('Live Touch staged a pattern/,
    'the explicit ARM stage acknowledgement must still reject an impossible chooser mismatch');
});

test('an armed pattern swap is retained, engine-confirmed, and refreshes local exports after landing', () => {
  const block = wire.match(/patSel\.addEventListener\('change'[\s\S]*?\n    \}\);/);
  assert.ok(block, 'Live Touch pattern change handler is missing');
  const source = block[0];
  const clearAt = source.indexOf("clearTransientSpatialContacts('pattern-switch', true)");
  const installAt = source.indexOf("req('PUT', '/layers/live_touch/pattern'");
  const transitionAt = source.indexOf("transition: { mode: 'trans_crossfade', durationMs: 500 }");
  const landingAt = source.indexOf('waitForPatternLanding(');
  const exportsAt = source.indexOf('refreshLiveExports()');
  const paletteAt = source.indexOf('pushPalette(true)');
  assert.ok(clearAt >= 0 && clearAt < installAt);
  assert.ok(transitionAt >= 0 && transitionAt < installAt);
  assert.ok(installAt < landingAt && landingAt < exportsAt);
  assert.ok(exportsAt < paletteAt);
  assert.match(source, /syncPatternSelection\(state\.channelPattern\);/,
    'the optimistic selection must revert to confirmed A before the request');
  assert.match(source, /result\.status !== 'transitioning'/);
});

test('Spatial owns exactly one contact command path and clears every transient lifecycle', () => {
  assert.doesNotMatch(wire, /state\.exports\.sliderTargetX/);
  assert.doesNotMatch(wire, /state\.exports\.sliderTargetY/);
  assert.doesNotMatch(wire, /state\.exports\.sliderTouch/);
  assert.match(wire, /var spatialWrite = settled \? req : write;/,
    'acknowledged TAKE samples must use the strict request path while live samples keep coalescing');
  assert.match(wire, /return spatialWrite\('POST', '\/spatial-paint', payload\.body\)\.then\(function \(response\) \{\s*commitSpatialPayload\(payload\);/,
    'contact truth may commit only after the selected transport promise resolves');
  assert.match(wire, /spatialPointers\.clear\(\)/);
  for (const reason of ['background', 'view-change', 'mode-switch', 'pattern-switch']) {
    assert.match(wire, new RegExp(`clearTransientSpatialContacts\\('${reason}'`));
  }
  assert.match(panel, /document\.addEventListener\('spatialcontactclear'/);
  assert.match(panel, /window\.addEventListener\('pagehide'/);
});

test('the wire never puts a raw pointerId on the wire — every stroke id is a compact 0..9 slot (BM26 fix wave W2)', () => {
  // The engine's setSpatialPaint validation (marsin_engine/lib/global_effects_controller.js
  // ~line 2135) rejects any strokes[].id that is not an integer in [0, 0x7fffffff].
  // WKWebView pointer ids can be huge or non-integer, so the wire must never
  // forward e.pointerId directly. Behavioral proof (huge/fractional ids,
  // stability, release+reuse, 10-concurrent distinctness) lives in
  // simulation/tests/touch_control_spatial_stroke_ids.test.js; this pins the
  // source shape so a future edit cannot silently regress it back to raw ids.
  assert.match(wire, /id: pointer\.slot,/, 'spatialPayload must send the compact slot as strokes[].id');
  assert.doesNotMatch(wire, /id: pointer\.id,/, 'the raw pointerId must never be the wire id again');
  assert.match(wire, /function allocateSpatialSlot\(\)/);
  assert.match(wire, /function releaseSpatialSlot\(slot\)/);
  assert.match(wire, /var spatialSlotUsed = \[false, false, false, false, false, false, false, false, false, false\];/,
    'the slot pool is fixed at exactly ten slots, matching the ten-touch cap');
  // pointer.id itself must still be the raw pointerId — it stays the
  // spatialPointers Map key and commitSpatialPayload's lookup key, unchanged.
  assert.match(wire, /id: e\.pointerId, slot: allocateSpatialSlot\(\), current: null, sent: null, retiring: false,/);
  assert.match(wire, /id: contactKey, slot: allocateSpatialSlot\(\), current: null, sent: null, retiring: false,/);
  // Every removal site must release the slot it allocated — a leaked slot
  // would eventually starve allocateSpatialSlot() even though pointers keep
  // being lifted.
  assert.match(wire, /spatialPointers\.forEach\(function \(pointer\) \{ releaseSpatialSlot\(pointer\.slot\); \}\);\s*\n\s*spatialPointers\.clear\(\);/);
  assert.match(wire, /releaseSpatialSlot\(pointer\.slot\);\s*\n\s*spatialPointers\.delete\(pointerId\);/);
  assert.match(wire, /if \(failedSpatialPointer\) releaseSpatialSlot\(failedSpatialPointer\.slot\);/);
});

test('a spatial sample declares its contact — the playback key is unreachable from any real pointer (BM26 _304)', () => {
  // pushXY used to resolve which spatialPointers entry to update with
  // `Number.isInteger(e.pointerId) ? e.pointerId : TAKE_POINTER_ID`, using the
  // SHAPE of the id as a proxy for "this is a real pointer". A WKWebView
  // pointer id that is a genuinely non-integer double therefore resolved to
  // the TAKE/playback entry: pointer.current was never set on the entry
  // pointerdown had created, so that finger silently disappeared from
  // strokes[] — a fallback, which AGENTS.md P0 forbids. Behavioral proof lives
  // in simulation/tests/touch_control_spatial_stroke_ids.test.js; these pin
  // the source shape.
  assert.doesNotMatch(wire, /Number\.isInteger\(e\.pointerId\)/,
    'pointer identity must never be inferred from whether the id is an integer');

  // The playback contact is keyed by a NON-NUMERIC sentinel. A DOM pointerId
  // is always a number, so no real finger can collide with it — the aliasing
  // class is removed by construction, not by picking an improbable integer.
  assert.match(wire, /var TAKE_PLAYBACK_PREFIX = 'take-playback-';/);
  assert.doesNotMatch(wire, /TAKE_(?:POINTER_ID|CONTACT_KEY) = 0x/,
    'the playback key must not live in the numeric pointerId namespace');

  // Synthetic playback samples DECLARE themselves with a bank-scoped contactKey;
  // every other sample resolves to its raw e.pointerId.
  const resolver = wire.match(/function spatialContactKey\(e\) \{[\s\S]*?\n    \}/);
  assert.ok(resolver, 'spatialContactKey is missing');
  assert.match(resolver[0], /if \(e\.spatialPlayback === true\) \{/);
  assert.match(resolver[0], /isTakePlaybackKey\(e\.contactKey\)/);
  assert.match(resolver[0], /return e\.contactKey;/);
  assert.match(resolver[0], /fail\('spatial touch'/,
    'an unidentifiable sample must be refused loudly, not routed somewhere convenient');
  assert.match(wire, /pushXY\(\{ spatialPlayback: true, contactKey: contactKey,/,
    'the TAKE replay path must carry the explicit marker and bank contactKey');
  assert.match(wire, /var pointerId = spatialContactKey\(e\);/);
});

test('Effects use catalog-authored behavior and Performance is action-only', () => {
  assert.doesNotMatch(wire, /TRIGGER_EFFECTS/);
  assert.match(wire, /behavior: behavior/);
  assert.match(wire, /m\.type === 'performanceMode'/);
  assert.match(wire, /status && status\.performanceMode && status\.performanceMode\.active/);
  assert.match(panel, /preset\.defaultBehavior/);
  assert.match(panel, /fxPanel\.classList\.toggle\('is-performance-locked', locked\)/);
  assert.match(panel, /fxEditToggle\.hidden = locked/);
  assert.match(panel, /\.effects-panel:not\(\.is-editing\) \.effects-grid \{[\s\S]*?repeat\(8,/);
});

test('Live Touch uses the canonical Layers blend without a private envelope', () => {
  assert.match(wire, /var LAYER_TRANSITION_MS = 100;/);
  assert.match(wire, /activateLayerSetting\('live_touch', 'live_touch_arm', true\)/);
  assert.match(wire, /activateLayerSetting\(target, reason, true\)/);
  assert.doesNotMatch(wire, /['"]\/arm-fade['"]/);
  assert.doesNotMatch(wire, /['"]\/param-center\/source-lock['"]/);
});

test('the COLOR HUB panel is the one explicitly authorized non-layer route (docs/70 W3)', () => {
  // /deck/color-autopilot used to be pinned OUT of this file entirely (this
  // test, before this wave): Live Touch had no reason to reach a Deck-scoped
  // route, and before the docs/70 §4.1 fan-out fix an armed session's shared
  // CPC was source-locked against the daemon's writes anyway, so reaching it
  // would have been pointless. docs/61 §4.1 states plainly it is
  // "Unauthenticated, unscoped: Live Touch may legally drive it today" — and
  // docs/70 §4.2 makes doing so via the COLOR HUB panel this wave's explicit
  // deliverable. The old blanket ban is retired FOR THIS ONE ROUTE; every
  // other Deck/Mixer-scoped surface stays out of reach (see the isolation
  // assertions elsewhere in this file, none of which are relaxed).
  assert.match(wire, /['"]\/deck\/color-autopilot['"]/);
  // Still exactly one socket: colorAutopilot rides the /ws/control connection
  // this file already owns (openControlSocket), never a second WebSocket.
  const controlSocketBlock = wire.match(/function openControlSocket\(\)[\s\S]*?\n  \}\n/);
  assert.ok(controlSocketBlock, 'openControlSocket is missing');
  assert.match(controlSocketBlock[0], /m\.type === 'colorAutopilot'/,
    'the colorAutopilot broadcast must be handled on the existing /ws/control socket');
  assert.doesNotMatch(wire, /new WebSocket\([^)]*color/i,
    'no second WebSocket may be opened for colour state');
  // Writes are relayed, never issued with the live_touch owner header or
  // queued into the ARM prepare-batch — /deck/color-autopilot is a public
  // Deck-level route, not a live_touch layer write.
  assert.match(wire, /function colorHubRequest\(method, path, body\)/);
  assert.match(wire, /state\.phase === 'armed'\) return requestJson\(method, path, body, true\)/);
  assert.match(wire, /return unownedReq\(method, path, body\)/);
  assert.match(wire, /colorHubRequest\(detail\.method, detail\.path \|\| '\/deck\/color-autopilot', detail\.body\)/);
});

test('Live Touch brush boots at M and every brush option row has uniform weight', () => {
  assert.match(panel, /id="brushSize" data-value="0\.05"/);
  assert.match(panel, /id="brushPower" data-value="0\.75"/);
  assert.match(panel, /id="brushSizeVal">M<\/span>/);
  assert.match(panel, /id="brushPowerVal">150%<\/span>/);
  assert.match(panel, /\.sp-controls #dutyRow, \.sp-controls #speedRow \{[\s\S]*?grid-column: auto;/);
  assert.match(panel, /#strobeDutyChips button, #zFaderChips button \{\s*min-height: 26px;/);
});

test('Color Hub reconciles engine-confirmed inline state before repainting A/B', () => {
  assert.match(panel, /function chAdoptBroadcastRing\(payload\)/);
  const broadcast = panel.match(/document\.addEventListener\('colorautopilot',[\s\S]*?\n    \}\);/);
  assert.ok(broadcast, 'Color Hub broadcast handler is missing');
  assert.match(broadcast[0], /chAdoptBroadcastRing\(CH\.broadcast\)/);
  assert.match(broadcast[0], /chRenderAll\(\)/);
});

test('initial ARM batches its complete Live look through atomic prepare', () => {
  const block = wire.match(/function assertLiveSurfaceState\(\)[\s\S]*?\n  \}\n\n  function armLiveTouch/);
  assert.ok(block, 'assertLiveSurfaceState is missing');
  assert.match(block[0], /prepareOperations = \[\]/);
  assert.match(block[0], /['"]\/layers\/live_touch\/prepare['"]/);
  assert.match(block[0], /performanceModeActive === true[\s\S]*?collectEffectSlotBuildOperations\(\)[\s\S]*?pushPalette\(true\)/,
    'Performance ARM must stage the visible palette before overlay actions become available');
  assert.match(block[0], /expectedSessionRevision: state\.sessionRevision/);
  assert.match(block[0], /brightness: brightness/);
  assert.match(block[0], /initialSpatialPrepareBody/);
  assert.doesNotMatch(block[0], /initializeLiveBrightness/);
  assert.doesNotMatch(block[0], /applyStatic\(true\)/);
});

test('the Live Touch wheel publishes its selected five-colour output to the private overlay palette', () => {
  const block = wire.match(/function pushPalette\(strict, skipEnginePair, explicitOutputPalette\)[\s\S]*?\n  \}\n\n  \/\* Reserved for any future per-slot colour effects/);
  assert.ok(block, 'pushPalette is missing');
  assert.match(block[0], /outputPaletteFromSelection/,
    'the visible candidate ring must put selected A/B first without dropping the other samples');
  assert.match(block[0], /strictWrite\('POST', '\/layers\/live_touch\/palette', \{ colorPalette: pal \}\)/,
    'atomic ARM must include the private overlay palette');
  assert.match(block[0], /pushOverlayPalette\(pal\)/,
    'wheel changes must update the private overlay palette while armed');
});

test('Edit ARM stages the session palette before movement slot provisioning', () => {
  const block = wire.match(/function assertLiveSurfaceState\(\)[\s\S]*?\n  \}\n\n  function armLiveTouch/);
  assert.ok(block, 'assertLiveSurfaceState is missing');
  const editArm = block[0].match(
    /req\('POST', '\/global-effects\/disable-all'[\s\S]*?reconcileEffects\(true\)/,
  );
  assert.ok(editArm, 'Edit ARM staging chain is missing');
  const editChain = editArm[0];
  const paletteAt = editChain.indexOf('pushPalette(true)');
  const slotsAt = editChain.indexOf('collectEffectSlotBuildOperations');
  assert.ok(paletteAt >= 0 && slotsAt > paletteAt,
    'Edit ARM must stage the five-colour session palette before slot PATCH operations');
});

test('assertLiveSurfaceState is exposed for headless ARM prepare verification', () => {
  assert.match(wire, /state\._assertLiveSurfaceState = assertLiveSurfaceState/);
});

test('movementTrace provisioning never sends session-owned colours through slot params', () => {
  assert.doesNotMatch(wire, /paletteRgb6\(/,
    'slot provisioning must not convert the wheel palette into slot paramsOverride.colors');
  const block = wire.match(/function provisionCell\(cell\)[\s\S]*?\n  \}\n\n  function buildEffectSlots/);
  assert.ok(block, 'provisionCell is missing');
  assert.doesNotMatch(block[0], /ov\.colors\s*=/,
    'slot paramsOverride.colors is refused — colours belong to /layers/live_touch/palette');
  assert.match(block[0], /movementTrace[\s\S]*?fadeSpan/,
    'movement slots still carry fade envelope params');
});

test('wheel palettechange refreshes session palette without slot colour patches', () => {
  assert.doesNotMatch(wire, /pushMovementColours\(/,
    'movementTrace colours are session-owned — wheel moves must not patch slot params');
  const block = wire.match(/slotsEl\.addEventListener\('palettechange'[\s\S]*?\n  \}\);/);
  assert.ok(block, 'palettechange handler is missing');
  assert.match(block[0], /pushPalette\(false/);
  assert.match(block[0], /pushEffectColours\(\)/);
  assert.doesNotMatch(block[0], /pushMovementColours\(/);
});

test('initial ARM brush geometry is verified and independent of Spatial visibility', () => {
  const initialSpatial = wire.match(
    /function initialSpatialPrepareBody\(\)[\s\S]*?\n  \}\n\n  function verifyPreparedSlots/,
  );
  assert.ok(initialSpatial, 'initialSpatialPrepareBody is missing');
  assert.match(initialSpatial[0], /window\.padBrushWorldCanonical\(\)/);
  assert.doesNotMatch(initialSpatial[0], /brushPatch\(/,
    'ARM staging must not depend on a rendered Spatial canvas');
  assert.match(panel, /window\.padBrushWorldCanonical = function/);
  assert.match(pixelViewsSource, /function worldBrushRadii\(fraction, target\)/);
  assert.match(pixelViewsSource, /pixel view has no rendered display projection/,
    'display projection failure must not impersonate failed pixel verification');
});

test('pixel views and spatial fade expose only canonical operator choices', () => {
  assert.match(panel, /id="pixelViewSelect"/);
  assert.match(panel, /id="pixelPan"/);
  assert.match(panel, /id="pixelFit"/);
  assert.match(panel, /\['0\.1 s', 0\.1\], \['0\.5 s', 0\.5\], \['1\.0 s', 1\], \['1\.5 s', 1\.5\]/);
  assert.match(wire, /\[0\.1, 0\.5, 1, 1\.5\]\.indexOf\(seconds\)/);
  assert.doesNotMatch(wire, /0\.12\s*\+[^\n]*7\.88/);
  const spatialFadeRow = panel.match(/id="fadeRow"[\s\S]*?<\/div>/);
  assert.ok(spatialFadeRow, 'spatial fadeRow is missing');
  assert.doesNotMatch(spatialFadeRow[0], /(?:8 s|8s|half-life)/i);
  assert.match(wire, /topPlane \? 'Z\+ FRONT' : 'Y\+ UP'/);
  assert.match(wire, /currentPixelViewId === 'te_sign'/);
  assert.match(wire, /<b>Z−<\/b>BACK/);
});

test('Spatial XY exposes one admitted contact, deferred multitouch, and Spatial-only fullscreen', () => {
  assert.match(panel, /id="spatialFullscreen" hidden aria-pressed="false"/);
  assert.match(panel, /is-spatial-fullscreen/);
  assert.match(panel, /if \(!spatial\) setFullscreen\(false\)/,
    'leaving Spatial mode must exit fullscreen');
  assert.match(panel, /event\.key === 'Escape'/,
    'Escape must provide a deterministic fullscreen exit');
  assert.match(panel, /document\.body\.appendChild\(panel\)/,
    'fullscreen must escape the two-row workspace before making it inert');
  assert.match(panel, /shell\.inert = true/,
    'surrounding Live Touch controls must not remain interactive behind fullscreen');
  assert.match(panel, /touchcontrol:spatial-fullscreen-request/,
    'embedded fullscreen must ask CaptainPad to promote the iframe');
  assert.match(themeSource, /touch-control-spatial-fullscreen/);
  const screenPath = path.resolve(here, '../../../CaptainPad/app/(tabs)/touch_control.tsx');
  /* The iframe, and the ancestor z-elevation that lifts it over the navigation
     rail, moved into the WEB half of the Live Touch surface pair when the iPad
     grew a WebView peer (report _252). The versioned handshake itself stayed on
     the platform-neutral screen, which is why the ack is still asserted there. */
  const webSurfacePath = path.resolve(
    here, '../../../CaptainPad/components/live_touch_surface.web.tsx');
  const screen = fs.readFileSync(screenPath, 'utf8');
  const webSurface = fs.readFileSync(webSurfacePath, 'utf8');
  assert.match(webSurface, /position: 'fixed'/);
  assert.match(webSurface, /height: '100dvh'/);
  assert.match(webSurface, /ancestor\.style\.zIndex = SPATIAL_FULLSCREEN_HOST_Z_INDEX/,
    'the fixed iframe host must outrank CaptainPad route stacking contexts');
  assert.match(webSurface, /element\.style\.zIndex = zIndex/,
    'fullscreen exit must restore every host ancestor inline z-index');
  assert.doesNotMatch(webSurface, /document\.body\.appendChild\(iframe\)/,
    'moving an iframe reloads its browsing context and destroys the live surface');
  assert.doesNotMatch(screen, /document\.body\.appendChild\(iframe\)/,
    'the screen must never reach past the surface to move the iframe either');
  assert.match(screen, /captainpad-spatial-fullscreen-applied/);
  assert.match(panel, /window\.TouchSpatialContactGate =/);
  assert.match(panel, /spatialLiveContact !== null && spatialLiveContact !== pointerId/);
  assert.match(panel, /SPATIAL contact limit reached; the extra touch was ignored/,
    'additional physical contacts must be refused loudly by the shared page gate');
  assert.match(panel, /take-playback-/);
  assert.match(panel, /touch_control_take_playback_overlay\.js/);
  assert.match(panel, /var padPointers = new Map\(\)/);
  assert.match(panel, /inkActiveRings = new Map\(\)/);

  assert.match(wire, /var spatialPointers = new Map\(\)/);
  assert.match(wire, /strokes: snapshots\.map/);
  assert.match(wire, /spatialPointers\.size >= 10/,
    'the internal wire pool retains engine compatibility without admitting UI multitouch');
  assert.match(wire, /pointer\.retiring/,
    'the sole admitted contact must retire only after its authoritative lift');
});

test('Spatial view adjustment owns gestures explicitly without consuming the admitted paint contact', () => {
  assert.match(panel, /id="pixelZoomOut"/);
  assert.match(panel, /id="pixelZoomIn"/);
  assert.match(panel, /id="pixelZoomValue"/);
  assert.match(pixelViewsSource, /var MIN_VIEW_ZOOM = 0\.5;/);
  assert.match(pixelViewsSource, /var MAX_VIEW_ZOOM = 4;/);
  assert.match(pixelViewsSource, /state\.panMode \|\| !state\.engineVerified/);
  assert.match(pixelViewsSource, /event\.stopImmediatePropagation\(\)/,
    'view navigation must stop paint handlers only while PAN owns the gesture');
  assert.match(pixelViewsSource, /kind: 'pinch'/);
  assert.match(pixelViewsSource, /state\.previewPointers\.size/,
    'PAN/zoom mode changes must not interrupt a live paint stroke');
});

test('group profiles load canonical views and route composite faders through real groups', () => {
  assert.match(panel, /id="groupProfileSelect"/);
  assert.match(panel, /id="groupProfileGrid"/);
  const profileScript = panel.indexOf('<script src="touch_control_group_profiles.js"></script>');
  const wireScript = panel.indexOf("document.write('<script src=\"touch_control_wire.js?v='");
  assert.ok(profileScript >= 0 && wireScript > profileScript,
    'group profile compiler must load before the engine wire installs it');
  assert.match(wire, /GET', '\/model\/view-selection-options'/);
  assert.match(wire, /groupprofilebrightnesschange/);
  assert.match(wire, /groupprofilemasterchange/);
});

test('every inline Live Touch script parses', () => {
  const scripts = [...panel.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .filter(source => source.trim().length > 0);
  assert.ok(scripts.length > 0);
  scripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source), `inline script ${index} must parse`);
  });
});

test('ARM executes lease before staging and every assertion before activation', async () => {
  const context = { window: {}, Promise, Object, Error };
  vm.runInNewContext(lifecycleSource, context, { filename: lifecyclePath });
  const order = [];
  const step = name => async () => { order.push(name); };
  await context.window.TouchControlLifecycle.arm({
    isCancelled: () => false,
    verify: step('verify'),
    acquireLease: step('lease'),
    stage: step('stage'),
    assertState: step('assert'),
    activate: step('activate'),
    waitForLanding: step('land'),
    markArmed: step('armed'),
  });
  assert.deepEqual(order, ['verify', 'lease', 'stage', 'assert', 'activate', 'land', 'armed']);
});

test('ARM never activates after a staged assertion fails', async () => {
  const context = { window: {}, Promise, Object, Error };
  vm.runInNewContext(lifecycleSource, context, { filename: lifecyclePath });
  const order = [];
  await assert.rejects(context.window.TouchControlLifecycle.arm({
    isCancelled: () => false,
    verify: async () => { order.push('verify'); },
    acquireLease: async () => { order.push('lease'); },
    stage: async () => { order.push('stage'); },
    assertState: async () => { order.push('assert'); throw new Error('assertion failed'); },
    activate: async () => { order.push('activate'); },
    waitForLanding: async () => { order.push('land'); },
    markArmed: async () => { order.push('armed'); },
  }), /assertion failed/);
  assert.deepEqual(order, ['verify', 'lease', 'stage', 'assert']);
});

test('handoff planning never acknowledges a superseding destination before activation', () => {
  const context = { window: {}, Promise, Object, Error };
  vm.runInNewContext(lifecycleSource, context, { filename: lifecyclePath });
  const plan = context.window.TouchControlLifecycle.planHandoff;

  assert.equal(plan('armed', {
    target: 'deck', reason: 'navigation', forceDestination: true,
  }), 'handback');
  // Mixer arrives while Deck is handing back; after Deck lands the wire is
  // idle, but Mixer must still run and prove a second canonical activation.
  assert.equal(plan('idle', {
    target: 'mixer', reason: 'navigation', forceDestination: true,
  }), 'activate');
  assert.equal(plan('idle', {
    target: 'deck', reason: 'background', forceDestination: false,
  }), 'ack');
  assert.equal(plan('disarming', {
    target: 'mixer', reason: 'navigation', forceDestination: true,
  }), 'wait');
});

test('bfcache restore fails closed from every in-flight lifecycle phase', () => {
  const context = { window: {}, Promise, Object, Error, Number };
  vm.runInNewContext(lifecycleSource, context, { filename: lifecyclePath });
  const shouldFailClosed = context.window.TouchControlLifecycle.shouldFailClosedAfterPageShow;
  assert.equal(shouldFailClosed(false, 'armed'), false);
  assert.equal(shouldFailClosed(true, 'idle'), false);
  assert.equal(shouldFailClosed(true, 'arming'), true);
  assert.equal(shouldFailClosed(true, 'armed'), true);
  assert.equal(shouldFailClosed(true, 'disarming'), true);
  const recovery = context.window.TouchControlLifecycle.pageShowRecovery;
  assert.equal(recovery(false, 'armed'), 'none');
  assert.equal(recovery(true, 'arming'), 'cancel_arm');
  assert.equal(recovery(true, 'armed'), 'handback');
  assert.equal(recovery(true, 'disarming'), 'continue_handback');
  const block = wire.match(/window\.addEventListener\('pageshow'[\s\S]*?\n  \}\);/);
  assert.ok(block, 'pageshow recovery handler is missing');
  assert.match(block[0], /pageShowRecovery/);
  assert.match(block[0], /pageSessionInvalidated = true/);
  assert.match(block[0], /startArmChain\(false\)/);
  assert.doesNotMatch(block[0], /forceDisarmedUi/);
});

test('a frozen ARM cannot resume past its current step after page invalidation', async () => {
  const context = { window: {}, Promise, Object, Error, Number };
  vm.runInNewContext(lifecycleSource, context, { filename: lifecyclePath });
  const order = [];
  let cancelled = false;
  let finishStage;
  const stageGate = new Promise(resolve => { finishStage = resolve; });
  const arming = context.window.TouchControlLifecycle.arm({
    isCancelled: () => cancelled,
    verify: async () => { order.push('verify'); },
    acquireLease: async () => { order.push('lease'); },
    stage: async () => { order.push('stage'); await stageGate; },
    assertState: async () => { order.push('assert'); },
    activate: async () => { order.push('activate'); },
    waitForLanding: async () => { order.push('land'); },
    markArmed: async () => { order.push('armed'); },
  });
  await new Promise(resolve => setImmediate(resolve));
  cancelled = true;
  finishStage();
  await assert.rejects(arming, /cancelled by page lifecycle/);
  assert.deepEqual(order, ['verify', 'lease', 'stage']);
});

test('Live and Dimmer Rack revisions are accepted independently without regression', () => {
  const context = { window: {}, Promise, Object, Error, Number };
  vm.runInNewContext(lifecycleSource, context, { filename: lifecyclePath });
  const accept = context.window.TouchControlLifecycle.revisionAcceptance;
  assert.deepEqual(
    { ...accept(8, 5, 7, 6) },
    { live: false, rack: true, effective: false },
  );
  assert.deepEqual(
    { ...accept(8, 5, 9, 4) },
    { live: true, rack: false, effective: false },
  );
  assert.deepEqual(
    { ...accept(8, 5, 9, 6) },
    { live: true, rack: true, effective: true },
  );
  assert.throws(() => accept(8, 5, 9, -1), /non-negative integers/);
});

test('CaptainPad requests background handback even while a non-Layers tab is focused', () => {
  const screenPath = path.resolve(here, '../../../CaptainPad/app/(tabs)/touch_control.tsx');
  const screen = fs.readFileSync(screenPath, 'utf8');
  assert.match(screen, /AppState\.addEventListener\('change'/);
  assert.match(screen, /document\.addEventListener\('visibilitychange'/);
  assert.match(screen, /requestHandoff\('deck', 'background'\)/);
  assert.match(screen, /layerDestinationForNavigationState\(navigation\.getState\(\)\)/);
  const backgroundBlock = screen.match(/const handoffForBackground = \(\) => \{[\s\S]*?\n    \};/);
  assert.ok(backgroundBlock, 'CaptainPad background handoff is missing');
  assert.doesNotMatch(backgroundBlock[0], /frameFocusedRef\.current/);
  assert.match(backgroundBlock[0], /!frameLoadedRef\.current/);
});

test('non-Layers navigation preserves Live while Deck and Mixer serialize handback', () => {
  const screenPath = path.resolve(here, '../../../CaptainPad/app/(tabs)/touch_control.tsx');
  const coordinatorPath = path.resolve(here, '../../../CaptainPad/components/live_touch_coordinator.tsx');
  const layoutPath = path.resolve(here, '../../../CaptainPad/app/(tabs)/_layout.tsx');
  const deckPath = path.resolve(here, '../../../CaptainPad/app/(tabs)/index.tsx');
  const mixerPath = path.resolve(here, '../../../CaptainPad/app/(tabs)/mixer.tsx');
  const screen = fs.readFileSync(screenPath, 'utf8');
  const coordinator = fs.readFileSync(coordinatorPath, 'utf8');
  const layout = fs.readFileSync(layoutPath, 'utf8');
  const deck = fs.readFileSync(deckPath, 'utf8');
  const mixer = fs.readFileSync(mixerPath, 'utf8');

  const focusBlock = screen.match(/useFocusEffect\([\s\S]*?\n  \);/);
  assert.ok(focusBlock, 'Live Touch focus lifecycle is missing');
  assert.doesNotMatch(focusBlock[0], /setTimeout/);
  assert.match(focusBlock[0], /const target = layerDestinationForNavigationState\(navigation\.getState\(\)\);[\s\S]*?if \(target\) \{[\s\S]*?requestHandoff\(target\)/);
  assert.match(screen, /const target = layerDestinationForNavigationAction\(event\.data\.action\);\s*if \(!target\) return;\s*event\.preventDefault\(\)/);
  assert.match(layout, /requestedLayer !== 'deck' && requestedLayer !== 'mixer'[\s\S]*?navigation\.navigate\(route\.name\)/);
  assert.match(coordinator, /waitForHandoff: \(target: LayerDestination\) => Promise<boolean \| null>/);
  assert.match(coordinator, /destinationActivationDecision/);
  assert.doesNotMatch(coordinator, /await new Promise<void>\(\(resolve\) => \{ setTimeout\(resolve, 0\)/);
  assert.match(coordinator, /surfaceFocusedRef\.current/);
  assert.match(coordinator, /readAuthoritativeLayerSettings/);
  assert.match(coordinator, /layerSettingsRequireLiveHandoff/);
  assert.match(deck, /waitForHandoff\('deck'\)\.then/);
  assert.match(deck, /if \(handoffResult !== null\) return/);
  assert.match(mixer, /waitForHandoff\('mixer'\)\.then/);
  assert.match(mixer, /if \(handoffResult !== null\) return/);
});

test('handback proves landing and cleanup before acknowledged lease release', () => {
  const block = wire.match(/function handbackLiveTouch[\s\S]*?function finishArmChain/);
  assert.ok(block, 'handbackLiveTouch implementation is missing');
  const source = block[0];
  const landedAt = source.indexOf('waitForLayerSetting(target');
  const cleanupAt = source.indexOf('.then(cleanupThenReleaseArmLease)');
  const idleAt = source.indexOf("setArmUiPhase('idle')");
  assert.ok(landedAt >= 0 && landedAt < cleanupAt);
  assert.ok(cleanupAt < idleAt);

  const releaseHelper = wire.match(
    /function cleanupThenReleaseArmLease[\s\S]*?\n  \}/,
  );
  assert.ok(releaseHelper, 'cleanup/release safety helper is missing');
  assert.ok(
    releaseHelper[0].indexOf('cleanupLiveState()')
      < releaseHelper[0].indexOf('.then(releaseArmLease)'),
    'every cleanup attempt must finish before the lease release',
  );
});

test('post-lease ARM abort cleans up before release and cannot ACK navigation', () => {
  const block = wire.match(/function abortArm[\s\S]*?function runSeries/);
  assert.ok(block, 'abortArm implementation is missing');
  const source = block[0];
  assert.match(source, /\.then\(cleanupThenReleaseArmLease\)/);
  assert.doesNotMatch(source, /acknowledgeSurfaceRelease/);
});

test('disarm cleanup uses overlay slot actions and proves no effect state remains', () => {
  const block = wire.match(/function cleanupLiveState[\s\S]*?\n  var armEl/);
  assert.ok(block, 'cleanupLiveState implementation is missing');
  const source = block[0];
  assert.doesNotMatch(source, /req\('POST', '\/movement-rate'/,
    'cleanup must never call the retired movement endpoint');
  assert.match(source, /slot\.effectId === 'movementTrace' && slot\.active === true/);
  assert.match(source, /\/global-effect-slots\/.*\/deactivate/,
    'all active movement generators must deactivate through authoritative slots');
  assert.match(source, /req\('POST', '\/global-effects\/disable-all'/,
    'true effects must still use the session-owned sweep');
  assert.match(source, /handbackStep\('effect-readback', verifyEffectsCleared\(\)\)/,
    'lease release must follow authoritative zero-state readback');
  assert.match(wire,
    /function restoreEffectColours\(\) \{\s*\/\*[\s\S]*?if \(state\.performanceModeActive === true\) return Promise\.resolve\(\)/,
    'Performance disarm must never PATCH its action-only private slot configuration');
  assert.match(source, /handbackFailures = null/,
    'cleanup must release its guard so a clean retry remains idempotent');
});

test('Effect Control WALK tunes the active private movement slot without the retired route', () => {
  assert.doesNotMatch(wire, /write\('POST', '\/movement-rate'/,
    'the Effect Control pad must never call the retired owner-scoped movement route');
  assert.match(wire,
    /movementPath = '\/global-effect-slots\/' \+ movementSlotId \+ '\/movement-rate'/,
    'WALK must tune the active authoritative movement slot');
  assert.match(wire, /Turn on a movement effect before tuning WALK speed\./,
    'touching WALK without an active movement effect must explain the required action calmly');
});

test('strict ARM assertions are authorized during the arming phase', () => {
  assert.match(wire, /state\.phase === 'armed' \|\| \(strict === true && state\.phase === 'arming'\)/);
  assert.match(wire, /function pushEffectColours\(strict\)[\s\S]*?liveStateCanWrite\(strict\)/);
  assert.match(wire, /function buildEffectSlots\(\)[\s\S]*?liveStateCanWrite\(true\)/);
  assert.match(wire, /function reconcileEffects\(strict\)[\s\S]*?liveStateCanWrite\(strict\)/);
  assert.match(wire, /staticWanted = desiredStatic\(strict\)/);
});

test('passive catalog construction never provisions Live effect slots', () => {
  assert.match(
    wire,
    /fxGrid\.addEventListener\('fxassign',[\s\S]*?if \(!liveStateCanWrite\(false\)\) return;[\s\S]*?provisionCell\(cell\)/,
  );
});

test('Live Touch brightness never writes Dimmer Rack or Mixer authority', () => {
  assert.match(wire, /['"]\/touch-control\/brightness['"]/);
  assert.match(wire, /['"]\/touch-control\/brightness\/master\/fade['"]/);
  assert.doesNotMatch(wire, /['"]\/section-brightness['"]/);
  assert.doesNotMatch(wire, /['"]\/mixer\/master\/fade['"]/);
  assert.doesNotMatch(wire, /(?:write|strictWrite|req)\('PATCH', '\/mixer'/);
  assert.doesNotMatch(wire, /var master = .*m\.master/);
});

test('hard page exit preserves the Live look for the canonical blend', () => {
  const block = wire.match(/window\.addEventListener\('pagehide'[\s\S]*?\n  \}\);/);
  assert.ok(block, 'pagehide handback is missing');
  assert.match(block[0], /\/layers\/activate/);
  assert.doesNotMatch(block[0], /audio-bindings|group-fixed-colors|strobe-rate|movement-rate/);
});

test('standalone Live Touch declares its local theme instead of claiming CaptainPad inheritance', () => {
  assert.match(themeSource, /window\.parent === window/);
  assert.match(themeSource, /classList\.add\('standalone-dark'\)/);
});

test('Live Touch shows a compact dismissible Timeline lease notice', () => {
  const screenPath = path.resolve(here, '../../../CaptainPad/app/(tabs)/touch_control.tsx');
  const bannerPath = path.resolve(here, '../../../CaptainPad/components/PlanLockBanner.tsx');
  const screen = fs.readFileSync(screenPath, 'utf8');
  const banner = fs.readFileSync(bannerPath, 'utf8');
  assert.match(screen, /<PlanLockBanner \/>/);
  assert.match(banner, /leaseHeld && !leaseDismissed/);
  assert.match(banner, /setLeaseDismissed\(true\)/);
  assert.match(banner, /accessibilityLabel="Dismiss takeover lease notice"/);
});

test('Color Hub exposes the shared COLOR TRANSITION fader and timing authority', () => {
  assert.match(panel, /touch_control_color_transition_timing\.js/);
  assert.match(panel, /id="chColorTransitionFader"/);
  assert.match(panel, /COLOR TRANSITION/);
  assert.match(wire, /ColorTransitionTiming/);
  assert.match(wire, /colortransitiontiming/);
  assert.match(wire, /pushFadeToEngine/);
});

test('spatial contact limit routes to a transient status notice, not fail()', () => {
  assert.match(panel, /touch_control_spatial_contact_notice\.js/);
  assert.match(panel, /id="panelStatus" role="status" aria-live="polite"/);
  const gateBlock = panel.match(/function reportExtraSpatialContact\(pointerId\) \{[\s\S]*?\n  \}/);
  assert.ok(gateBlock, 'reportExtraSpatialContact is missing');
  assert.match(gateBlock[0], /SpatialContactNotice\.show\(\)/);
  assert.doesNotMatch(gateBlock[0], /panelerror/);
  assert.match(wire, /SpatialContactNotice\.show\(\)/);
  assert.match(wire, /SpatialContactNotice\.cleanup\(\)/);
});

test('Presets layout pins Spatial and evicts Color Hub before opening the playlist', () => {
  assert.match(panel, /NON_DISPLACEABLE_PANEL_KEYS = \['spatial-panel'\]/);
  assert.match(panel, /PRESETS_OPEN_EVICTION_ORDER = \['colorhub-panel', 'color-panel'\]/);
  assert.match(panel, /function preparePresetsWorkspace/);
  assert.match(panel, /has-presets-open/);
  assert.match(panel, /if \(panelKey\(target\) === 'presets-panel'\) preparePresetsWorkspace\(\)/);
});

test('preset recall exposes one wire preflight for ARM, lease, catalog, and store readiness', () => {
  assert.match(wire, /state\._preflightPresetRecall = function \(pageChecks\)/);
  assert.match(wire, /ARM Live Touch before recalling a preset/);
  assert.match(wire, /effect catalog to confirm before recalling a preset/);
  assert.match(wire, /background catalog to confirm before recalling a preset/);
  assert.match(wire, /preset store to confirm before recalling a preset/);
  assert.match(panel, /_preflightPresetRecall\(\{/);
  assert.match(panel, /preset partially applied:/);
});
