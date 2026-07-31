/**
 * led_gamma_ui.js — the gamma row on every LED controller card, plus the
 * fleet-wide "Push gamma to ALL" action (report 20260725_29).
 *
 * DOM only. Every rule about what a valid curve is, what a push does, and how
 * the scene mirror stays honest lives in ../dmx/led/led_gamma.js — this module
 * renders it and wires the editor's mutate()/undo/toast pipeline in.
 *
 * The operator's model:
 *   - the four sliders (+ the live curve plot) are the SCENE MIRROR (what the
 *     sim preview believes the hardware is doing). Moving one changes the
 *     preview, nothing else.
 *   - "⬆ Push gamma" sends this card's curve to its controller (server-side:
 *     full-config backup → partial write → read-back verify) and writes the
 *     VERIFIED values back into the fields + a "pushed …" stamp.
 *   - "⬆ Push gamma to ALL" does that for every LED controller, one at a time,
 *     with a per-controller ok / failed / unreachable row. No silent partial
 *     success; an unreachable controller is named.
 */

import {
  GAMMA_CURVE_GEOMETRY,
  LED_GAMMA_CHANNELS,
  LED_GAMMA_MIN,
  LED_GAMMA_MAX,
  LED_GAMMA_PRESETS,
  LED_GAMMA_RECOMMENDED,
  LED_GAMMA_STEP,
  DEFAULT_GAMMA_TRANSPORT,
  activeGammaPresetKey,
  commitGammaPush,
  formatGamma,
  gammaCurvePath,
  gammaEquals,
  parseGammaField,
  pushGammaFleet,
  pushGammaToController,
  quantizeGamma,
  readGammaMirror,
  setGammaMirror,
} from '../dmx/led/led_gamma.js';
import { isLedController, isValidIp } from '../dmx/controller_registry.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Wrap a mirror write in the editor's mutate() so it is dirty-marked + undoable. */
function commitThroughCtx(ctx, label) {
  return (controller, result) => {
    let thrown = null;
    ctx.mutate(label(controller), () => {
      try { commitGammaPush(controller, result); } catch (err) { thrown = err; }
    });
    if (thrown) throw thrown;
  };
}

// ── Per-controller gamma row ────────────────────────────────────────────────

/** Channel letter for a label / an aria string. */
const CH_LABEL = { r: 'R', g: 'G', b: 'B', w: 'W' };

/**
 * The inline SVG for the curve plot: the quarter grid, the dashed y = x
 * identity diagonal ("curve off" reference), an optional dashed GHOST of the
 * last hardware-verified curve, and the four live mirror curves.
 *
 * Inline-SVG-via-innerHTML is the established convention in this codebase
 * (control_drawer.js, left_drawer.js, split_layout.js) and it is what keeps
 * the offline P0 satisfied by construction — no library, no CDN, no font.
 * Every colour is a CSS class so the stylesheet owns the palette.
 *
 * @param {{r:number,g:number,b:number,w:number}} gamma - the live draft curve
 * @param {{r:number,g:number,b:number,w:number}|null} ghost - last verified
 *   hardware curve, drawn ONLY when it differs from `gamma`
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

/**
 * The gamma control for one LED controller card (report 20260725_65, design
 * 20260725_64): four R/G/B/W sliders over the scene mirror with read-only
 * 2-dp readouts, a Link-RGB toggle, three preset chips, a live curve plot,
 * the "⬆ Push gamma" button and the last verified-on-hardware stamp.
 * Returns null for a non-LED controller — DMX cards get nothing new.
 *
 * Interaction contract: `oninput` (dragging) repaints the local DRAFT only —
 * no mutate, no scene write, no refresh, so a drag never floods the undo
 * stack or re-renders the pane under the operator's finger. `onchange`
 * (release / keyboard commit) runs the value through parseGammaField (the one
 * validation source — it throws loudly) and commits exactly one ctx.mutate.
 */
export function renderGammaSection(ctx, controller) {
  if (!isLedController(controller)) return null;

  const section = el('div', 'cm-led-gamma');

  // The DRAFT: what the sliders are showing right now. Seeded from the mirror
  // and re-seeded on every commit, so a dropped drag can never leave the plot
  // claiming a curve the scene does not hold.
  let draft = readGammaMirror(controller);
  // Link RGB is EPHEMERAL UI state, per render — never written to
  // controllers.yaml. W is never linked (see the preset doctrine).
  let linkRgb = true;

  const errorLine = el('div', 'cm-led-gamma-error');
  errorLine.style.display = 'none';

  // ── Row 1: label · presets · link · push · provenance ─────────────────────
  const head = el('div', 'cm-led-gamma-head');
  const lbl = el('span', 'cm-led-lbl', 'gamma');
  lbl.title = 'Per-channel gamma correction. The LED CONTROLLER owns the one and only ' +
    'gamma curve in the chain — these sliders mirror it for the sim preview until you push. ' +
    `Range ${LED_GAMMA_MIN}–${LED_GAMMA_MAX} (1.0 = off, straight diagonal); recommended ` +
    `${formatGamma(LED_GAMMA_RECOMMENDED)} — keep W at 1.0 unless the white emitter is ` +
    'measured to need its own trim.';
  head.appendChild(lbl);

  const presetBtns = new Map();
  for (const preset of LED_GAMMA_PRESETS) {
    const chip = el('button', 'cm-btn cm-led-gamma-preset', preset.label);
    chip.title = preset.title;
    chip.onclick = () => {
      const next = { ...preset.gamma };
      ctx.mutate(`Set '${controller.name}' gamma preset ${preset.label}`, () => {
        setGammaMirror(controller, next);
      });
      draft = readGammaMirror(controller);
      errorLine.style.display = 'none';
      repaint();
    };
    presetBtns.set(preset.key, chip);
    head.appendChild(chip);
  }

  const linkWrap = el('label', 'cm-led-gamma-link');
  const linkBox = el('input');
  linkBox.type = 'checkbox';
  linkBox.checked = linkRgb;
  linkBox.onchange = () => { linkRgb = linkBox.checked; };
  linkWrap.title = 'Move R, G and B together. W is always independent — the controller ' +
    'derives white AFTER the RGB curve, so W wants its own (usually 1.0) exponent.';
  linkWrap.appendChild(linkBox);
  linkWrap.appendChild(el('span', undefined, 'Link RGB'));
  head.appendChild(linkWrap);

  const validIp = isValidIp(controller.ip);
  const pushBtn = el('button', 'cm-btn cm-led-gamma-push', '⬆ Push gamma');
  if (validIp) {
    pushBtn.title = 'Back up the controller\'s full config, write ONLY the gamma keys, read them ' +
      'back, and mirror the verified values here. No reboot unless the device asks for one.';
    pushBtn.onclick = () => runSingleGammaPush(ctx, controller, pushBtn);
  } else {
    pushBtn.disabled = true;
    pushBtn.title = 'set the device IP first';
  }
  head.appendChild(pushBtn);

  const dev = controller.device;
  const stamp = dev && dev.lastGammaPush;
  if (stamp) {
    const inSync = gammaEquals(stamp.gamma, readGammaMirror(controller));
    const prov = el('span', 'cm-led-gamma-prov' + (inSync ? '' : ' cm-led-gamma-drift'),
      inSync
        ? `✓ hardware ${formatGamma(stamp.gamma)} · ${new Date(stamp.at).toLocaleString()}`
        : `▲ hardware ${formatGamma(stamp.gamma)} ≠ mirror — push to apply`);
    prov.title = `Last verified on the controller: ${formatGamma(stamp.gamma)} ` +
      `(${stamp.outcome}) at ${stamp.at}`;
    head.appendChild(prov);
  } else {
    head.appendChild(el('span', 'cm-led-gamma-prov', '○ never pushed'));
  }
  section.appendChild(head);

  // ── Row 2: curve plot + the four sliders ──────────────────────────────────
  const body = el('div', 'cm-led-gamma-body');
  const plot = el('div', 'cm-led-gamma-plot');
  plot.title = 'Output vs input for each channel (y = x^γ). The dashed diagonal is ' +
    '1.0 = no correction; a dashed coloured curve is the last curve VERIFIED on the ' +
    'hardware, shown only while the mirror differs from it.';
  body.appendChild(plot);

  const sliders = el('div', 'cm-led-gamma-sliders');
  const rows = new Map();
  for (const ch of LED_GAMMA_CHANNELS) {
    const row = el('div', `cm-led-gamma-row cm-led-gamma-row-${ch}`);
    row.appendChild(el('span', 'cm-led-gamma-ch', CH_LABEL[ch]));

    const slider = el('input', 'cm-led-gamma-slider');
    slider.type = 'range';
    slider.min = String(LED_GAMMA_MIN);
    slider.max = String(LED_GAMMA_MAX);
    slider.step = String(LED_GAMMA_STEP);
    slider.value = String(draft[ch]);
    slider.title = `${CH_LABEL[ch]} exponent (${LED_GAMMA_MIN}–${LED_GAMMA_MAX}, ` +
      `step ${LED_GAMMA_STEP}, 1.0 = off). Moves the scene mirror (preview) — ` +
      'push to write it to the controller.';

    // Dragging: draft + repaint only. No mutate, no undo entry, no refresh.
    slider.oninput = () => {
      const v = Number(slider.value);
      if (linkRgb && ch !== 'w') {
        draft.r = v;
        draft.g = v;
        draft.b = v;
      } else {
        draft[ch] = v;
      }
      repaint();
    };

    // Release / keyboard commit: validate through the ONE source, then one mutate.
    slider.onchange = () => {
      let value;
      try {
        value = quantizeGamma(parseGammaField(slider.value, ch));
      } catch (err) {
        // Loud + local: refuse the write and put the sliders back on the truth.
        errorLine.textContent = `✋ ${err.message}`;
        errorLine.style.display = '';
        ctx.showToast(`✋ ${controller.name}: ${err.message}`, { error: true, ttl: 8000 });
        draft = readGammaMirror(controller);
        repaint();
        return;
      }
      errorLine.style.display = 'none';
      const linked = linkRgb && ch !== 'w';
      const next = { ...readGammaMirror(controller) };
      if (linked) {
        next.r = value;
        next.g = value;
        next.b = value;
      } else {
        next[ch] = value;
      }
      const what = linked ? 'rgb' : ch;
      ctx.mutate(`Set '${controller.name}' gamma ${what} = ${value}`, () => {
        setGammaMirror(controller, next);
      });
      draft = readGammaMirror(controller);
      repaint();
    };
    row.appendChild(slider);

    const readout = el('span', 'cm-led-gamma-val');
    row.appendChild(readout);
    sliders.appendChild(row);
    rows.set(ch, { slider, readout });
  }
  body.appendChild(sliders);
  section.appendChild(body);

  const caption = el('div', 'cm-led-gamma-caption', 'y = x^γ · applies live — no reboot');
  section.appendChild(caption);
  section.appendChild(errorLine);

  /** Redraw everything that depends on the draft. Never touches the scene. */
  function repaint() {
    const hw = stamp && stamp.gamma;
    const ghost = hw && !gammaEquals(hw, draft) ? hw : null;
    plot.innerHTML = buildCurveSvg(draft, ghost);
    for (const ch of LED_GAMMA_CHANNELS) {
      const row = rows.get(ch);
      row.readout.textContent = draft[ch].toFixed(2);
      if (Number(row.slider.value) !== draft[ch]) row.slider.value = String(draft[ch]);
    }
    const activeKey = activeGammaPresetKey(draft);
    for (const [key, chip] of presetBtns) {
      chip.classList.toggle('cm-on', key === activeKey);
    }
  }

  repaint();
  return section;
}

async function runSingleGammaPush(ctx, controller, pushBtn) {
  const label = pushBtn.textContent;
  pushBtn.disabled = true;
  pushBtn.textContent = '… pushing';
  const result = await pushGammaToController(controller, DEFAULT_GAMMA_TRANSPORT,
    commitThroughCtx(ctx, (c) => `Pushed gamma to '${c.name}'`));
  pushBtn.disabled = false;
  pushBtn.textContent = label;
  if (result.state === 'ok') {
    ctx.showToast(`✓ '${controller.name}' gamma ${formatGamma(result.verified)} verified on ` +
      `hardware (${result.outcome})`, { ttl: 8000 });
  } else {
    ctx.showToast(`✋ '${controller.name}' gamma push ${result.state}: ${result.detail}`,
      { error: true, ttl: 12000 });
  }
  ctx.refresh();
}

// ── Fleet push ──────────────────────────────────────────────────────────────

const STATE_LABEL = {
  ok: '✓ ok',
  failed: '✋ failed',
  unreachable: '⚠ unreachable',
  skipped: '– skipped',
  pending: '… waiting',
  running: '… pushing',
};

/**
 * "Push gamma to ALL LED controllers" — one confirm, then a sequential run
 * with a live per-controller result row. Every controller is listed by name
 * with its own outcome; nothing is rolled up into a single pass/fail.
 */
export function startFleetGammaPush(ctx) {
  const registry = ctx.registry();
  const leds = (registry && Array.isArray(registry.controllers))
    ? registry.controllers.filter(isLedController) : [];
  if (leds.length === 0) {
    ctx.showToast('No LED controllers to push — add or discover one first',
      { error: true, ttl: 6000 });
    return;
  }
  const pushable = leds.filter((c) => isValidIp(c.ip));

  const overlay = el('div', 'vm-modal-overlay');
  const card = el('div', 'vm-modal-card led-push-card');
  overlay.appendChild(card);
  card.appendChild(el('div', 'vm-modal-title',
    `Push gamma to ALL LED controllers (${pushable.length})`));
  card.appendChild(el('div', 'led-push-warn',
    `⚠ Each controller's own gamma fields are written to its hardware, SEQUENTIALLY: full-config ` +
    'backup → gamma-only write → read-back verify. Gamma normally applies live; a controller ' +
    'that asks for a reboot gets one and is re-verified after it comes back.'));

  const rows = new Map();
  const list = el('div', 'led-push-diff');
  for (const c of leds) {
    const row = el('div', 'led-push-diff-line');
    const state = el('span', 'led-gamma-row-state',
      isValidIp(c.ip) ? STATE_LABEL.pending : STATE_LABEL.skipped);
    row.appendChild(state);
    row.appendChild(el('span', 'led-gamma-row-name',
      ` ${c.name} (${c.ip || 'no IP'}) — ${formatGamma(readGammaMirror(c))}`));
    const detail = el('span', 'led-gamma-row-detail');
    row.appendChild(detail);
    list.appendChild(row);
    rows.set(c.id, { state, detail });
  }
  card.appendChild(list);

  const statusLine = el('div', 'led-push-status');
  card.appendChild(statusLine);

  const actions = el('div', 'vm-modal-actions');
  const cancelBtn = el('button', 'vm-modal-btn', 'Cancel');
  cancelBtn.onclick = () => overlay.remove();
  const confirmBtn = el('button', 'vm-modal-btn vm-modal-btn-primary', 'Push gamma to all');
  confirmBtn.disabled = pushable.length === 0;
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    statusLine.className = 'led-push-status';
    statusLine.textContent = `pushing ${pushable.length} controller(s) sequentially…`;

    // Mark each controller "pushing" as its turn comes up.
    let cursor = 0;
    const markRunning = () => {
      while (cursor < leds.length) {
        const c = leds[cursor];
        const row = rows.get(c.id);
        if (isValidIp(c.ip) && row) { row.state.textContent = STATE_LABEL.running; return; }
        cursor += 1;
      }
    };
    markRunning();

    const results = await pushGammaFleet(registry.controllers, DEFAULT_GAMMA_TRANSPORT, {
      commit: commitThroughCtx(ctx, (c) => `Pushed gamma to '${c.name}'`),
      onResult: (record) => {
        const row = rows.get(record.id);
        if (row) {
          row.state.textContent = STATE_LABEL[record.state] || record.state;
          row.state.className = `led-gamma-row-state led-gamma-row-${record.state}`;
          row.detail.textContent = record.state === 'ok'
            ? `  → ${formatGamma(record.verified)} (${record.outcome})`
            : `  → ${record.detail}`;
        }
        cursor += 1;
        markRunning();
      },
    });

    const ok = results.filter((r) => r.state === 'ok');
    const failed = results.filter((r) => r.state === 'failed');
    const unreachable = results.filter((r) => r.state === 'unreachable');
    const skipped = results.filter((r) => r.state === 'skipped');
    const bad = failed.length + unreachable.length;
    statusLine.className = 'led-push-status' + (bad ? ' led-push-error' : ' led-push-ok');
    statusLine.textContent =
      `done — ${ok.length} ok · ${failed.length} failed · ${unreachable.length} unreachable · ` +
      `${skipped.length} skipped` +
      (unreachable.length ? ` · unreachable: ${unreachable.map((r) => r.name).join(', ')}` : '') +
      (failed.length ? ` · failed: ${failed.map((r) => `${r.name} (${r.detail})`).join('; ')}` : '');
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Close';
    ctx.showToast(`Gamma push: ${ok.length} ok, ${bad} problem(s)`,
      { error: bad > 0, ttl: 9000 });
    ctx.refresh();
  };
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  card.appendChild(actions);
  overlay.onkeydown = (e) => { if (e.key === 'Escape' && !confirmBtn.disabled) cancelBtn.click(); };
  document.body.appendChild(overlay);
  confirmBtn.focus();
}
