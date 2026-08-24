/**
 * led_gamma_ui.js — the gamma row on every LED controller card: PUSH-ENABLED,
 * PULL-FREE (report 20260725_29 built it; `_364` parked it; the operator
 * re-enabled the push side once the config push was live-validated on four real
 * boards).
 *
 * WHAT THIS SECTION IS NOW:
 *   1. The sliders and preset chips are LIVE, and they are the CURVE SOURCE.
 *      They edit the scene mirror (`led.wire.controllerGamma`) — the same values
 *      the sim preview models — through the editor's mutate/undo pipeline.
 *   2. "⬆ Push gamma" is LIVE. It states this card's curve to the board and asks
 *      the board to confirm it: pre-write identity gate → ONE getStatus +
 *      getConfig → buildGammaPushBody → POST → read-back → per-channel epsilon
 *      compare → toast + provenance stamp. Gamma is LIVE-APPLY on this firmware,
 *      so no reboot is expected (a `needs-reboot` reply is still honored).
 *   3. There is NO PULL, and there never will be (operator ruling, unconditional
 *      — `_364` §1.3). No refresh button, no read-mirror-from-device, no cache,
 *      no fleet source harvest. Even the SUCCESS path does not adopt the
 *      device's float32 read-back into the scene: the mirror is the source, the
 *      device only confirms it.
 *
 * Consequence to keep true: this module makes NO network call of its own. Every
 * device hop goes through led_discovery_panel.js (`pushGammaToDevice`), which
 * owns the identity gate, the retried read-back and the provenance write — the
 * same machinery the config push and the DMX toggle were validated on.
 */

import {
  GAMMA_CURVE_GEOMETRY,
  LED_GAMMA_CHANNELS,
  LED_GAMMA_MIN,
  LED_GAMMA_MAX,
  LED_GAMMA_PRESETS,
  LED_GAMMA_RECOMMENDED,
  LED_GAMMA_STEP,
  activeGammaPresetKey,
  formatGamma,
  gammaCurvePath,
  gammaEquals,
  parseGammaField,
  quantizeGamma,
  readGammaMirror,
  setGammaMirror,
} from '../dmx/led/led_gamma.js';
import { pushGammaToDevice } from './led_discovery_panel.js';
import { isLedController, isValidIp } from '../dmx/controller_registry.js';

/** The one sentence that states what this section does and does NOT do. */
const GAMMA_PUSH_NOTE =
  'these sliders are the source of the curve — ⬆ Push gamma states them to the board and reads ' +
  'them back to confirm. The sim never reads gamma back off a device to change them.';

/** Why a control is dead when the card has no usable device IP. */
const GAMMA_NO_IP_NOTE = 'set the device IP first';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ── Per-controller gamma row ────────────────────────────────────────────────

/** Channel letter for a label / an aria string. */
const CH_LABEL = { r: 'R', g: 'G', b: 'B', w: 'W' };

/**
 * The inline SVG for the curve plot: the quarter grid, the dashed y = x
 * identity diagonal ("curve off" reference), an optional dashed GHOST of the
 * last hardware-verified curve, and the four mirror curves.
 *
 * Inline-SVG-via-innerHTML is the established convention in this codebase
 * (control_drawer.js, left_drawer.js, split_layout.js) and it is what keeps
 * the offline P0 satisfied by construction — no library, no CDN, no font.
 * Every colour is a CSS class so the stylesheet owns the palette.
 *
 * @param {{r:number,g:number,b:number,w:number}} gamma - the scene mirror curve
 * @param {{r:number,g:number,b:number,w:number}|null} ghost - last curve a push
 *   verified on the hardware, drawn ONLY when it differs from `gamma`
 */
function buildCurveSvg(gamma, ghost) {
  const { width, height, pad } = GAMMA_CURVE_GEOMETRY;
  const innerW = width - 2 * pad;
  const innerH = height - 2 * pad;
  const parts = [];

  parts.push(`<rect class="cm-gamma-plot-bg" x="0.5" y="0.5" width="${width - 1}" ` +
    `height="${height - 1}" rx="3"/>`);

  for (const q of [0.25, 0.5, 0.75]) {
    const gx = Math.round((pad + q * innerW) * 10) / 10;
    const gy = Math.round((pad + q * innerH) * 10) / 10;
    parts.push(`<line class="cm-gamma-plot-grid" x1="${gx}" y1="${pad}" x2="${gx}" ` +
      `y2="${pad + innerH}"/>`);
    parts.push(`<line class="cm-gamma-plot-grid" x1="${pad}" y1="${gy}" ` +
      `x2="${pad + innerW}" y2="${gy}"/>`);
  }

  // γ = 1.0 is the identity diagonal — the "no correction" reference.
  parts.push(`<path class="cm-gamma-plot-ident" d="${gammaCurvePath(1)}"/>`);

  if (ghost) {
    for (const ch of LED_GAMMA_CHANNELS) {
      parts.push(`<path class="cm-gamma-plot-curve cm-gamma-plot-ghost cm-gamma-plot-${ch}" ` +
        `d="${gammaCurvePath(ghost[ch])}"/>`);
    }
  }

  for (const ch of LED_GAMMA_CHANNELS) {
    parts.push(`<path class="cm-gamma-plot-curve cm-gamma-plot-${ch}" ` +
      `d="${gammaCurvePath(gamma[ch])}"/>`);
  }

  const aria = LED_GAMMA_CHANNELS.map((ch) => `${CH_LABEL[ch]} ${gamma[ch].toFixed(2)}`).join(', ');
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" ` +
    `role="img" aria-label="gamma curves: ${aria}">${parts.join('')}</svg>`;
}

/** The provenance line: the last push this card recorded, or nothing yet. */
function buildProvenance(controller, mirror) {
  const stamp = controller.device && controller.device.lastGammaPush;
  const prov = el('span', 'cm-led-gamma-prov');
  if (!stamp) {
    prov.textContent = '○ no gamma push recorded';
    prov.title = 'This card has never recorded a verified gamma push. Set the curve with the ' +
      'sliders, then press ⬆ Push gamma.';
    return prov;
  }
  const inSync = gammaEquals(stamp.gamma, mirror);
  if (!inSync) prov.className += ' cm-led-gamma-drift';
  prov.textContent = inSync
    ? `✓ hardware ${formatGamma(stamp.gamma)} · ${new Date(stamp.at).toLocaleString()}`
    : `▲ hardware ${formatGamma(stamp.gamma)} ≠ these sliders`;
  prov.title = `Last curve a sim push VERIFIED on this controller: ${formatGamma(stamp.gamma)} ` +
    `(${stamp.outcome}) at ${stamp.at}. This is a receipt of what was pushed — nothing ` +
    're-reads the device.';
  return prov;
}

/**
 * Write a curve into the scene mirror through the editor's undo pipeline and
 * re-render the pane. The ONE mutation path in this module — every control
 * (sliders, presets, Link RGB) goes through it, so the curve can never be
 * changed by a path that skips the validator or the dirty flag.
 */
function commitCurve(ctx, controller, gamma) {
  ctx.mutate(`Gamma on '${controller.name}'`, () => {
    setGammaMirror(controller, gamma);
  });
  ctx.refresh();
}

/**
 * The gamma control for one LED controller card.
 *
 * @param {Object} ctx - the LED panel bridge (mutate / refresh / showToast /
 *   registry / activeScene). REQUIRED: the sliders mutate the scene and the push
 *   button talks to a device, and neither can be done without it.
 * @param {Object} controller - the LED card.
 * @returns {HTMLElement|null} null for a non-LED controller — DMX cards get nothing.
 */
export function renderGammaSection(ctx, controller) {
  if (!isLedController(controller)) return null;
  if (!ctx || typeof ctx.mutate !== 'function' || typeof ctx.refresh !== 'function') {
    throw new Error('[LedGammaUi] renderGammaSection needs the LED panel ctx — the sliders mutate ' +
      'the scene through mutate()/refresh() and the push button talks to a device');
  }

  const section = el('div', 'cm-led-gamma');
  const mirror = readGammaMirror(controller);   // SCENE read only — no I/O, ever
  const pushable = isValidIp(controller.ip);

  // ── Row 1: label · presets · link · push · provenance ─────────────────────
  const head = el('div', 'cm-led-gamma-head');
  const lbl = el('span', 'cm-led-lbl', 'gamma');
  lbl.title = 'Per-channel gamma correction. The LED CONTROLLER owns the one and only ' +
    'gamma curve in the chain; these values are what the sim preview models AND what ' +
    `⬆ Push gamma writes to the board. Range ${LED_GAMMA_MIN}–${LED_GAMMA_MAX} (1.0 = off, ` +
    `straight diagonal); recommended ${formatGamma(LED_GAMMA_RECOMMENDED)} — keep W at 1.0 ` +
    `unless the white emitter is measured to need its own trim. ${GAMMA_PUSH_NOTE}`;
  head.appendChild(lbl);

  const activeKey = activeGammaPresetKey(mirror);
  for (const preset of LED_GAMMA_PRESETS) {
    const chip = el('button', 'cm-btn cm-led-gamma-preset', preset.label);
    chip.title = `${preset.title}. Sets these sliders; press ⬆ Push gamma to write it to the board.`;
    if (preset.key === activeKey) chip.classList.add('cm-on');
    chip.onclick = () => commitCurve(ctx, controller, { ...preset.gamma });
    head.appendChild(chip);
  }

  // Link RGB is a per-render interaction mode, deliberately NOT persisted: it
  // describes how the operator wants to DRAG, not anything about the rig.
  const linkWrap = el('label', 'cm-led-gamma-link');
  const linkBox = el('input');
  linkBox.type = 'checkbox';
  linkBox.checked = true;
  linkWrap.title = 'Move R, G and B together while dragging a slider (W always keeps its own ' +
    'value — the device derives white AFTER the RGB curve).';
  linkWrap.appendChild(linkBox);
  linkWrap.appendChild(el('span', undefined, 'Link RGB'));
  head.appendChild(linkWrap);

  const pushBtn = el('button', 'cm-btn cm-led-gamma-push', '⬆ Push gamma');
  pushBtn.disabled = !pushable;
  pushBtn.title = pushable
    ? `Write ${formatGamma(mirror)} to ${controller.ip} and read it back to confirm it. ` +
      'Gamma applies LIVE — the board does not reboot. Nothing else is written: strand counts, ' +
      `universes, DMX input and swarm are all untouched. ${GAMMA_PUSH_NOTE}`
    : GAMMA_NO_IP_NOTE;
  if (pushable) {
    pushBtn.onclick = () => pushGammaToDevice(ctx, controller, readGammaMirror(controller),
      undefined, pushBtn);
  }
  head.appendChild(pushBtn);

  head.appendChild(buildProvenance(controller, mirror));
  section.appendChild(head);

  // ── Row 2: curve plot + the four sliders ──────────────────────────────────
  const body = el('div', 'cm-led-gamma-body');
  const plot = el('div', 'cm-led-gamma-plot');
  plot.title = 'Output vs input for each channel (y = x^γ). The dashed diagonal is ' +
    '1.0 = no correction; a dashed coloured curve is the last curve a push VERIFIED on the ' +
    'hardware, shown only while these sliders differ from it.';
  const ghost = (controller.device && controller.device.lastGammaPush &&
    controller.device.lastGammaPush.gamma) || null;
  plot.innerHTML = buildCurveSvg(mirror, ghost && !gammaEquals(ghost, mirror) ? ghost : null);
  body.appendChild(plot);

  const sliders = el('div', 'cm-led-gamma-sliders');
  for (const ch of LED_GAMMA_CHANNELS) {
    const row = el('div', `cm-led-gamma-row cm-led-gamma-row-${ch}`);
    row.appendChild(el('span', 'cm-led-gamma-ch', CH_LABEL[ch]));

    const slider = el('input', 'cm-led-gamma-slider');
    slider.type = 'range';
    slider.min = String(LED_GAMMA_MIN);
    slider.max = String(LED_GAMMA_MAX);
    slider.step = String(LED_GAMMA_STEP);
    slider.value = String(mirror[ch]);
    slider.title = `${CH_LABEL[ch]} exponent. ${GAMMA_PUSH_NOTE}`;
    // `change` (not `input`): one undo entry per drag, not one per pixel. The
    // value is parsed + range-checked by led_gamma.js — a slider that somehow
    // reported an out-of-range number is a LOUD toast, never a clamp.
    slider.onchange = () => {
      let value;
      try {
        value = quantizeGamma(parseGammaField(slider.value, CH_LABEL[ch]));
      } catch (err) {
        ctx.showToast(`✋ ${controller.name}: ${err.message}`, { error: true, ttl: 8000 });
        ctx.refresh();
        return;
      }
      const next = { ...mirror };
      if (linkBox.checked && ch !== 'w') {
        next.r = value; next.g = value; next.b = value;
      } else {
        next[ch] = value;
      }
      commitCurve(ctx, controller, next);
    };
    row.appendChild(slider);

    row.appendChild(el('span', 'cm-led-gamma-val', mirror[ch].toFixed(2)));
    sliders.appendChild(row);
  }
  body.appendChild(sliders);
  section.appendChild(body);

  section.appendChild(el('div', 'cm-led-gamma-caption',
    'y = x^γ · the controller applies it — the sim wire stays linear'));

  section.appendChild(el('div', 'cm-led-gamma-note', `⬆ ${GAMMA_PUSH_NOTE}`));

  return section;
}
