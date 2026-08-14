import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const wirePath = path.resolve(here, '../../../docs/ui/touch_control_wire.js');
const wire = fs.readFileSync(wirePath, 'utf8');
const panelPath = path.resolve(here, '../../../docs/ui/touch_control.html');
const panel = fs.readFileSync(panelPath, 'utf8');
const lifecyclePath = path.resolve(here, '../../../docs/ui/touch_control_lifecycle.js');
const lifecycleSource = fs.readFileSync(lifecyclePath, 'utf8');
const themePath = path.resolve(here, '../../../docs/ui/touch_control_theme.js');
const themeSource = fs.readFileSync(themePath, 'utf8');

test('Live Touch routes patterns and controls to its isolated layer', () => {
  assert.match(wire, /['"]\/layers\/live_touch\/pattern['"]/);
  assert.match(wire, /['"]\/layers\/live_touch\/control['"]/);
  assert.doesNotMatch(wire, /['"]\/pattern['"]/);
  assert.doesNotMatch(wire, /['"]\/control['"]/);
});

test('the pattern selector and isolated Live pattern map agree exactly', () => {
  const selectBlock = panel.match(/<select class="select" id="patternSel">([\s\S]*?)<\/select>/);
  assert.ok(selectBlock, 'Live Touch is missing its pattern selector');
  const optionIds = [...selectBlock[1].matchAll(/<option value="(\d+)"/g)].map(match => match[1]);
  const mapBlock = wire.match(/var PATTERN_FILES = \{([\s\S]*?)\n  \};/);
  assert.ok(mapBlock, 'Live Touch wire is missing PATTERN_FILES');
  const mappedIds = [...mapBlock[1].matchAll(/'(\d+)':/g)].map(match => match[1]);
  assert.deepEqual(optionIds.sort(), mappedIds.sort());
  assert.deepEqual(mappedIds.sort(), ['128', '129', '130']);
});

test('an armed pattern swap refreshes instance-local exports before reasserting palette', () => {
  const block = wire.match(/patSel\.addEventListener\('change'[\s\S]*?\n    \}\);/);
  assert.ok(block, 'Live Touch pattern change handler is missing');
  const source = block[0];
  const installAt = source.indexOf("write('PUT', '/layers/live_touch/pattern'");
  const exportsAt = source.indexOf('refreshLiveExports()');
  const paletteAt = source.indexOf('pushPalette(true)');
  assert.ok(installAt >= 0 && installAt < exportsAt);
  assert.ok(exportsAt < paletteAt);
});

test('Live Touch uses the canonical Layers blend without a private envelope', () => {
  assert.match(wire, /var LAYER_TRANSITION_MS = 100;/);
  assert.match(wire, /activateLayerSetting\('live_touch', 'live_touch_arm', true\)/);
  assert.match(wire, /activateLayerSetting\(target, reason, true\)/);
  assert.doesNotMatch(wire, /['"]\/arm-fade['"]/);
  assert.doesNotMatch(wire, /['"]\/param-center\/source-lock['"]/);
  assert.doesNotMatch(wire, /['"]\/deck\/color-autopilot['"]/);
});

test('initial ARM batches its complete Live look through atomic prepare', () => {
  const block = wire.match(/function assertLiveSurfaceState\(\)[\s\S]*?\n  \}\n\n  function armLiveTouch/);
  assert.ok(block, 'assertLiveSurfaceState is missing');
  assert.match(block[0], /prepareOperations = \[\]/);
  assert.match(block[0], /['"]\/layers\/live_touch\/prepare['"]/);
  assert.match(block[0], /expectedSessionRevision: state\.sessionRevision/);
  assert.match(block[0], /brightness: brightness/);
  assert.match(block[0], /initialSpatialPrepareBody/);
  assert.doesNotMatch(block[0], /initializeLiveBrightness/);
  assert.doesNotMatch(block[0], /applyStatic\(true\)/);
});

test('pixel views and spatial fade expose only canonical operator choices', () => {
  assert.match(panel, /id="pixelViewSelect"/);
  assert.match(panel, /id="pixelPan"/);
  assert.match(panel, /id="pixelFit"/);
  assert.match(panel, /\['0\.1 s', 0\.1\], \['0\.5 s', 0\.5\], \['1\.0 s', 1\], \['1\.5 s', 1\.5\]/);
  assert.match(wire, /\[0\.1, 0\.5, 1, 1\.5\]\.indexOf\(seconds\)/);
  assert.doesNotMatch(wire, /0\.12\s*\+[^\n]*7\.88/);
  assert.doesNotMatch(panel, /FADE[^\n]*(?:8 s|8s|half-life)/i);
  assert.match(wire, /topPlane \? 'Z\+ SHIP FORWARD' : 'Y\+ UP'/);
  assert.match(wire, /currentPixelViewId === 'te_sign'/);
  assert.match(wire, /<b>Z−<\/b>AFT/);
});

test('Spatial XY exposes bounded independent multitouch and Spatial-only fullscreen', () => {
  assert.match(panel, /id="spatialFullscreen" hidden aria-pressed="false"/);
  assert.match(panel, /is-spatial-fullscreen/);
  assert.match(panel, /if \(!spatial\) setFullscreen\(false\)/,
    'leaving Spatial mode must exit fullscreen');
  assert.match(panel, /event\.key === 'Escape'/,
    'Escape must provide a deterministic fullscreen exit');
  assert.match(panel, /var padPointers = new Map\(\)/);
  assert.match(panel, /inkActiveRings = new Map\(\)/);
  assert.doesNotMatch(panel, /var padPointer = null/,
    'the retired one-finger gate must not discard additional touches');

  assert.match(wire, /var spatialPointers = new Map\(\)/);
  assert.match(wire, /strokes: snapshots\.map/);
  assert.match(wire, /spatialPointers\.size >= 10/,
    'browser input must enforce the same bounded batch as the engine');
  assert.match(wire, /pointer\.retiring/,
    'one lift must retire only its own stroke');
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
  const cleanupAt = source.indexOf('.then(cleanupLiveState)');
  const releaseAt = source.indexOf('.then(releaseArmLease)');
  const idleAt = source.indexOf("setArmUiPhase('idle')");
  assert.ok(landedAt >= 0 && landedAt < cleanupAt);
  assert.ok(cleanupAt < releaseAt);
  assert.ok(releaseAt < idleAt);
});

test('post-lease ARM abort cleans up before release and cannot ACK navigation', () => {
  const block = wire.match(/function abortArm[\s\S]*?function runSeries/);
  assert.ok(block, 'abortArm implementation is missing');
  const source = block[0];
  assert.ok(source.indexOf('.then(cleanupLiveState)') < source.indexOf('.then(releaseArmLease)'));
  assert.doesNotMatch(source, /acknowledgeSurfaceRelease/);
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
