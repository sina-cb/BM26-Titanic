import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI = path.join(__dirname, '..', '..', 'audio', 'companion', 'ui');
const HTML = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(UI, 'companion_app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(UI, 'companion_app.css'), 'utf8');

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// The app source with whole-line comments dropped, for assertions that must see
// CODE only (the file's prose mentions the very APIs we ban).
const APP_CODE = APP.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

test('DERIVED TUNE remains accessible alongside the newer PARTY panel', () => {
  assert.match(HTML, /id="nav-derived"[^>]*data-page="derived"[^>]*role="tab"/);
  assert.match(HTML, /id="page-derived"[^>]*role="tabpanel"[^>]*aria-labelledby="nav-derived"/);
  assert.match(APP, /const pages = \['design', 'mic', 'party', 'derived', 'osc'\]/);
  assert.match(APP, /aria-selected/);
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.match(APP, new RegExp(key));
});

test('BPM SLEW moved to DERIVED TUNE without changing IDs or wire message', () => {
  const oscStart = HTML.indexOf('id="page-osc"');
  const micStart = HTML.indexOf('id="page-mic"');
  const derivedStart = HTML.indexOf('id="page-derived"');
  const modalStart = HTML.indexOf('id="export-modal"');
  const oscPage = HTML.slice(oscStart, micStart);
  const derivedPage = HTML.slice(derivedStart, modalStart);
  for (const id of ['bpm-slew-on', 'bpm-slew-slider', 'bpm-slew-num']) {
    assert.equal(count(HTML, `id="${id}"`), 1, `${id} must remain unique`);
    assert.doesNotMatch(oscPage, new RegExp(`id="${id}"`));
    assert.match(derivedPage, new RegExp(`id="${id}"`));
  }
  assert.match(APP, /type: 'setBpmSlew', enabled, bpmPerSec: n/);
  assert.match(APP, /if \(S\.page === 'derived'\) syncBpmSlewControl\(\)/);
});

test('derived controls consume authoritative config and use the supported edit protocol', () => {
  assert.match(APP, /if \(m\.derivedConfig\) S\.derivedConfig = m\.derivedConfig/);
  assert.match(APP, /m\.type === 'derivedConfig'/);
  assert.match(APP, /S\.derivedConfig = m\.config/);
  assert.match(APP, /type: 'setDerivedConfig', group, patch:/);
  assert.match(APP, /m\.derivedMetrics/);
  assert.match(APP, /partyLoudness/);
  assert.match(APP, /silenceLoudness/);
  for (const group of [
    'noteTracking', 'party', 'trackChange', 'switch', 'bandOnsets', 'chestHit',
    'phrase', 'dropCountdown',
  ]) {
    assert.ok(
      APP.includes(`group: '${group}'`) || HTML.includes(`data-group="${group}"`),
      `${group} controls are present`,
    );
  }
});

test('silence copy distinguishes source gates from whole-scene detection', () => {
  assert.match(HTML, /This is <b>not<\/b> the microphone noise floor/);
  assert.match(HTML, /combines the gated LOW, MID and HIGH bands/);
  assert.match(HTML, /Tune whole-scene silence/);
  assert.match(HTML, /engine sync:/);
});

test('note color wheel edits hue only with bright full-saturation/value previews', () => {
  assert.match(HTML, /id="derived-note-colors-title">NOTES → COLORS/);
  assert.match(HTML, /SAT 100%/);
  assert.match(HTML, /VALUE 100%/);
  assert.match(HTML, /id="note-color-wheel"[^>]*Circle-of-fifths note color mapping/);
  assert.match(APP, /NOTE_COLOR_FIFTHS = \['c', 'g', 'd', 'a', 'e', 'b', 'fSharp', 'cSharp', 'gSharp', 'dSharp', 'aSharp', 'f'\]/);
  assert.match(APP, /group: 'noteColors'/);
  assert.match(HTML, /id="note-color-reset-all"[^>]*>RESET ALL<\/button>/);
  assert.match(APP, /type: 'resetDerivedConfig',[\s\S]*group: 'noteColors'/);
  assert.match(HTML, /RESET ALL restores all 12 hues to the supplied reference wheel/);
  assert.match(APP, /hsl\(\$\{hue\.toFixed\(1\)\},100%,50%\)/);
  assert.doesNotMatch(HTML, /note-color-(?:saturation|value)/);
});

test('note smoothing is visible, state-backed, and explained in musical time', () => {
  assert.match(HTML, /id="derived-note-tracking-title">NOTE TRACKING/);
  assert.match(HTML, /data-group="noteTracking"/);
  for (const key of ['medianN', 'minConsensus', 'holdHops', 'nearHoldHops', 'stableHops']) {
    assert.match(HTML, new RegExp(`data-key="${key}"`), `${key} control is present`);
  }
  assert.match(HTML, /124 BPM beat/);
  assert.match(APP, /S\.derivedConfig\.noteTracking/);
});

test('noteTracking inputs offer only what the validator accepts', async () => {
  // The bounds are NOT restated here — they come from the estimator's own
  // NOTE_ESTIMATOR_RANGES, so a future range change fails this test instead of
  // silently leaving the UI offering values the server can only refuse.
  const { NOTE_ESTIMATOR_RANGES } = await import('../../audio/signals/note_estimator.js');
  const inputs = {
    medianN: 'derived-note-window',
    minConsensus: 'derived-note-consensus',
    holdHops: 'derived-note-confirm',
    nearHoldHops: 'derived-note-near-hold',
    nearChangeSemitones: 'derived-note-near-range',
    stableHops: 'derived-note-stable',
    energyGate: 'derived-note-gate',
    preferLowEnergyFrac: 'derived-note-low-bias',
  };
  for (const [key, id] of Object.entries(inputs)) {
    const tag = HTML.match(new RegExp(`<input id="${id}"[^>]*>`));
    assert.ok(tag, `${id} input exists`);
    const spec = NOTE_ESTIMATOR_RANGES[key];
    const attrOf = (name) => Number((tag[0].match(new RegExp(`${name}="([^"]+)"`)) || [])[1]);
    const step = attrOf('step');
    const offeredMin = spec.exclusiveMin ? spec.min + step : spec.min;
    const offeredMax = spec.exclusiveMax ? spec.max - step : spec.max;
    assert.equal(attrOf('min'), offeredMin, `${key} min matches the validator`);
    assert.equal(attrOf('max'), offeredMax, `${key} max matches the validator`);
    assert.ok(tag[0].includes(`data-key="${key}"`), `${id} edits ${key}`);
  }
  // The odd-window rule is gone: medianN must not step by 2 any more.
  assert.doesNotMatch(HTML, /id="derived-note-window"[^>]*step="2"/);
});

test('note response time is stated honestly for both near and far moves', () => {
  // ceil(medianN * minConsensus) + hold − 1 hops at 86.13 hops/s. The old
  // (medianN + holdHops) form charged the whole window and ignored
  // nearHoldHops — a single ~0.29 s underclaim.
  assert.doesNotMatch(APP, /medianN \+ noteTracking\.holdHops/);
  assert.match(APP, /Math\.ceil\(values\.medianN \* values\.minConsensus\)/);
  assert.match(APP, /consensus \+ values\[holdKey\] - 1/);
  assert.match(APP, /noteResponseHops\(values, 'holdHops'\)/);
  assert.match(APP, /noteResponseHops\(values, 'nearHoldHops'\)/);
  assert.match(APP, /const ANALYSIS_HOPS_PER_SEC = 86\.13/);
  assert.match(APP, /s far \/ \$\{near\} s near move/);
  assert.match(APP, /measured ~\$\{NOTE_MEASURED_TYPICAL_S/);
  // The static copy must not ship the old single-number claim either.
  assert.doesNotMatch(HTML, /change response is about 0\.29 seconds/);
  assert.match(HTML, /id="derived-note-timing">Ideal response ≈ 0\.21 s far \/ 0\.37 s near move/);
});

test('the shipped note defaults land on the documented far/near latencies', async () => {
  // Pins the formula against the DSP defaults (medianN 15, minConsensus 0.55,
  // holdHops 10, nearHoldHops 24 → 18 and 32 hops).
  const { NOTE_ESTIMATOR_DEFAULTS: d } = await import('../../audio/signals/note_estimator.js');
  const hops = (hold) => Math.ceil(d.medianN * d.minConsensus) + d[hold] - 1;
  assert.equal((hops('holdHops') / 86.13).toFixed(2), '0.21');
  assert.equal((hops('nearHoldHops') / 86.13).toFixed(2), '0.37');
});

test('the page nav cannot collapse on a narrow viewport', () => {
  // .top-right is a flex row; without flex:0 0 auto the 4-tab nav shrank to a
  // couple of pixels at ≤430px and NO page was reachable.
  assert.match(CSS, /\.nav-seg\{display:flex;flex:0 0 auto;/);
  assert.match(CSS, /\.nav-btn\{[^}]*white-space:nowrap/);
  assert.match(CSS, /@media \(max-width:780px\)\{[\s\S]*?\.top-right\{width:100%;overflow-x:auto/);
});

test('hue-tinted note text stays readable while the swatches stay full-value', () => {
  // The chips keep hsl(h,100%,50%); the LETTER uses the theme's readable
  // lightness token instead (l=50% blue was ~1.6:1 on the dark panels).
  assert.match(APP, /function noteLetterCss/);
  assert.match(APP, /hsl\(\$\{hue\.toFixed\(1\)\},85%,var\(--note-letter-l\)\)/);
  assert.match(APP, /nn\.style\.color = noteLetterCss\(dv\.hue\)/);
  assert.doesNotMatch(APP, /nn\.style\.color = noteColor/);
  // Every theme (and :root) must DECLARE both tokens — no silent inherit.
  assert.equal((CSS.match(/--note-letter-l:\d/g) || []).length, 5);
  assert.equal((CSS.match(/--warn:#/g) || []).length, 5);
  // Wheel key labels are computed per key from that key's own swatch luminance.
  assert.match(APP, /function hueLuminance/);
  assert.match(APP, /function keyLabelStyle/);
  assert.match(APP, /button\.style\.color = label\.color/);
  assert.match(APP, /button\.style\.textShadow = label\.textShadow/);
});

test('engine-offline reads as a warning, not as muted body text', () => {
  assert.match(CSS, /\.mic-link-state\.warn\{color:var\(--warn\)\}/);
  assert.doesNotMatch(CSS, /\.mic-link-state\.warn\{color:var\(--muted\)\}/);
  assert.match(APP, /local only \(engine offline\)/);
});

test('RESET ALL takes two taps and lapses back on its own', () => {
  assert.match(HTML, /id="note-color-reset-all"[^>]*>RESET ALL<\/button>/);
  assert.match(APP, /const NOTE_RESET_ARM_MS = \d+/);
  assert.match(APP, /if \(S\.noteResetArmed\) \{[\s\S]*type: 'resetDerivedConfig'/);
  assert.match(APP, /armNoteColorReset\(\)/);
  assert.match(APP, /button\.textContent = 'CONFIRM RESET'/);
  assert.match(APP, /setTimeout\(disarmNoteColorReset, NOTE_RESET_ARM_MS\)/);
  assert.match(CSS, /\.note-color-selected button\.armed\{/);
  assert.match(HTML, /Tap it once to arm, then tap CONFIRM RESET within 3 seconds/);
  // Never a native browser dialog.
  assert.doesNotMatch(APP_CODE, /\bconfirm\(/);
});

test('TEMPO OUTPUT shows published against raw BPM', () => {
  assert.match(HTML, /id="bpm-published"/);
  assert.match(HTML, /id="bpm-raw"/);
  assert.match(APP, /fetch\('\/signal_snapshot'\)/);
  assert.match(APP, /snapshot\.bpmOutput/);
  assert.match(APP, /if \(S\.page === 'derived'\) \{ buildDerivedPage\(\); startTempoPoll\(\); \} else stopTempoPoll\(\)/);
  // Absent data renders "—", never a stand-in number.
  assert.match(APP, /Number\.isFinite\(v\) && v > 0 \? v\.toFixed\(1\) : '—'/);
});

test('BPM SLEW inputs agree on their range and theme', () => {
  assert.match(HTML, /id="bpm-slew-slider"[^>]*min="1" max="240"/);
  assert.match(HTML, /id="bpm-slew-num"[^>]*min="1" max="240"/);
  assert.doesNotMatch(APP, /slider\.value = Math\.min\(120, S\.bpmSlew\.bpmPerSec\)/);
  assert.match(APP, /slider\.value = S\.bpmSlew\.bpmPerSec/);
  assert.match(CSS, /\.orc-slew-on input\[type="checkbox"\]\{accent-color:var\(--accent\)/);
});

test('derived fields disable themselves until the authoritative config arrives', () => {
  // `values && values[key]` yields null (not undefined) with no config, so the
  // fields never disabled and offered edits against a config we do not have.
  assert.match(APP, /const value = values \? values\[input\.dataset\.key\] : undefined/);
  assert.match(APP, /input\.disabled = value === undefined/);
});

test('DERIVED TUNE has labels, keyboard focus, and responsive layouts', () => {
  for (const id of [
    'derived-track-off', 'derived-track-on', 'derived-track-confirm', 'derived-track-gap',
    'derived-party-off', 'derived-party-on', 'derived-party-hold', 'derived-party-confirm',
    'derived-note-window', 'derived-note-consensus', 'derived-note-confirm',
    'derived-note-stable',
    'note-color-hue',
    'bpm-slew-on', 'bpm-slew-slider', 'bpm-slew-num',
  ]) {
    assert.match(HTML, new RegExp(`<label[^>]+for="${id}"`), `${id} has a label`);
  }
  assert.match(CSS, /\.nav-btn:focus-visible/);
  // Every keyboard-reachable control on this page shows the ring, not just the
  // tabs: the wheel keys, the hue slider/number, the slew toggle, and both
  // <summary> disclosures were focusable but rendered no focus indicator.
  for (const selector of [
    '\\.note-color-key:focus-visible',
    '#note-color-hue:focus-visible',
    '#note-color-hue-num:focus-visible',
    '#bpm-slew-on:focus-visible',
    '\\.derived-advanced summary:focus-visible',
    '\\.derived-event-group summary:focus-visible',
  ]) {
    assert.match(CSS, new RegExp(selector), `${selector} has a focus ring`);
  }
  assert.match(CSS, /@media \(max-width:920px\)/);
  assert.match(CSS, /@media \(max-width:620px\)/);
  assert.match(HTML, /role="status" aria-live="polite"/);
});
