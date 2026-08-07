/**
 * controller_map_panel.js — Modern (Preact) shell for the Controller
 * Mapping editor.
 *
 * "Modern shell, legacy brain" (see SHELL_NOTES.md): Preact renders the
 * panel chrome and the empty #cm-body container EXACTLY as index.html's
 * static markup, then the untouched legacy module
 * (src/gui/controller_map_editor.js) runs against it —
 * setupControllerMapEditor() attaches every event handler and its
 * internal render() rebuilds #cm-body via direct DOM manipulation.
 *
 * HANDLER-OWNERSHIP DECISION: this shell deliberately does NOT use
 * FloatingPanel and owns NO event handlers for the panel chrome.
 * setupControllerMapEditor() already attaches drag (pointerdown/move/up with
 * pointer capture on #cm-drag-handle) and collapse (#cm-collapse-btn.onclick) —
 * the same situation as the Views shell; FloatingPanel would double-attach drag
 * and race the legacy collapse toggle.
 *
 * The chrome is a fully static component — no signals, no state, rendered
 * exactly once — so Preact never diffs over #cm-body's legacy-built children or
 * the inline left/top set by dragging.
 *
 * ── THE ONE EXCEPTION: the BENCH MIRROR control (report 20260805_155 §8.1) ──
 *
 * It mounts as its OWN Preact root into a dedicated <span> in the header, so it
 * can be signal-driven (it must follow the bridge's status broadcasts) without
 * making the shell stateful and without the legacy body losing handler
 * ownership of anything. Two independent roots, one static and one live, is
 * exactly the SHELL_NOTES discipline.
 *
 * It lives HERE rather than in the sACN IN monitor because that monitor is only
 * rendered while the lighting engine mode is `sacn_in` — and `sacn_in` is
 * precisely the mode that turns every sim window into a hard-coded priority-150
 * sACN writer to the ship's controllers. The operator could not reach the old
 * button without being in the mode that defeated the mirror at the box.
 */

import { render } from 'preact';
import { html } from 'htm/preact';
import { signal } from '@preact/signals';

import { benchMirrorControlState } from '../bench_mirror_control.js';
import { benchMirrorPickerState, pickerDefaults, pickerSetSource,
  pickerSetReverse } from '../bench_mirror_picker.js';

const BENCH_MIRROR_POLL_MS = 500;

/** Live view of the bridge's bench-mirror state, polled off `window.sacnInput`. */
const benchMirror = signal(null);
const benchLinkUp = signal(false);
/** null = the picker is closed. */
const pickerOptions = signal(null);
const pickerDraft = signal(null);
const pickerBusy = signal(false);
const pickerError = signal('');

function logToMonitor(msg, level) {
  if (window.sacnInLog) window.sacnInLog(msg, level);
}

function openPicker(scene) {
  const source = window.sacnInput;
  if (!source) return;
  pickerBusy.value = true;
  pickerError.value = '';
  pickerOptions.value = null;
  pickerDraft.value = null;
  source.queryBenchMirrorOptions(scene).then((options) => {
    pickerOptions.value = options;
    pickerDraft.value = null;
  }).catch((err) => {
    pickerError.value = err.message;
    logToMonitor(`✋ bench mirror options failed: ${err.message}`, 'error');
  }).finally(() => { pickerBusy.value = false; });
}

function closePicker() {
  pickerOptions.value = null;
  pickerDraft.value = null;
  pickerError.value = '';
}

function confirmPicker(state, scene) {
  const source = window.sacnInput;
  if (!source) return;
  pickerBusy.value = true;
  // The COMPLETE selection map goes on the wire — every slot explicitly, as
  // `{source, reverse}`, with `source: null` for the ones held dark. A partial
  // map is refused by the bridge (R-13) precisely so "absence" can never be read
  // as a choice, and the old flat `slot: name` shape is refused by name (R-24)
  // so an absent `reverse` can never be guessed as `false`.
  source.armBenchMirror(scene, state.selection).then((status) => {
    if (status && status.refusal) {
      pickerError.value = status.refusal;
      logToMonitor(`✋ ${status.refusal}`, 'warn');
    } else {
      closePicker();
    }
    for (const w of (status && status.warnings) || []) logToMonitor(`⚠ ${w}`, 'warn');
  }).catch((err) => {
    pickerError.value = err.message;
    logToMonitor(`✋ bench mirror arm failed: ${err.message}`, 'error');
  }).finally(() => { pickerBusy.value = false; });
}

function runDisarm() {
  const source = window.sacnInput;
  if (!source) return;
  source.disarmBenchMirror().then((status) => {
    if (status && status.refusal) logToMonitor(`✋ ${status.refusal}`, 'warn');
  }).catch((err) => {
    logToMonitor(`✋ bench mirror disarm failed: ${err.message}`, 'error');
  });
}

function BenchMirrorPicker({ scene }) {
  const state = benchMirrorPickerState(pickerOptions.value, pickerDraft.value);
  const setSlot = (slot, value) => {
    pickerDraft.value = pickerSetSource(state.selection, slot, value);
  };
  const setReverse = (row, value) => {
    pickerDraft.value = pickerSetReverse(state.selection, row.slot, value, row.reverseApplicable);
  };
  return html`
    <div id="bench-mirror-picker" style=${'position:fixed;top:12%;left:50%;' +
      'transform:translateX(-50%);z-index:1200;min-width:520px;max-width:760px;' +
      'max-height:76vh;overflow:auto;background:var(--surface-container-lowest);' +
      'border:1px solid var(--primary);border-radius:10px;padding:14px 16px;' +
      'font-family:var(--font-body);font-size:12px;box-shadow:0 8px 32px rgba(0,0,0,0.5);'}>
      <div style="font-family:var(--font-headline);font-weight:700;margin-bottom:2px;">
        ${state.title}
      </div>
      <div style="color:var(--secondary);margin-bottom:10px;">${state.subtitle}</div>
      ${state.refusal ? html`
        <div id="bench-mirror-picker-refusal"
             style="color:var(--error);white-space:pre-wrap;margin-bottom:10px;">
          ✋ ${state.refusal}
        </div>` : null}
      ${state.warnings.map((w) => html`
        <div class="bench-mirror-picker-warning"
             style="color:var(--error);white-space:pre-wrap;margin-bottom:8px;">⚠ ${w}</div>`)}
      ${state.rows.map((row) => html`
        <div style="margin-bottom:5px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:96px;color:var(--secondary);">${row.slot}</span>
          <span style="width:104px;">${row.benchFixture}</span>
          <span style="width:104px;color:var(--secondary);">${row.profile}</span>
          <select style="flex:1;" disabled=${row.empty}
                  value=${row.value === null ? '' : row.value}
                  onChange=${(e) => setSlot(row.slot, e.target.value)}>
            ${row.choices.map((c) => html`
              <option value=${c.value === null ? '' : c.value}>${c.label}</option>`)}
          </select>
          ${row.reverseApplicable ? html`
            <button class="pe-btn bench-mirror-reverse-toggle"
                    id=${`bench-mirror-reverse-${row.slot}`}
                    title=${row.reverseTitle}
                    style=${'padding:2px 8px;min-width:96px;' + (row.reverse
                      ? 'background:var(--error);color:var(--surface-container-lowest);' +
                        'border:1px solid var(--error);'
                      : 'border:1px solid var(--secondary);')}
                    onClick=${() => setReverse(row, !row.reverse)}>
              ${row.reverse ? '⇄ REVERSED' : '→ NORMAL'}
            </button>` : html`
            <span style="min-width:96px;color:var(--secondary);opacity:0.5;text-align:center;"
                  title=${row.reverseTitle}>—</span>`}
          ${row.duplicate ? html`<span title="this source also feeds another slot — allowed"
            style="color:var(--primary);">×2</span>` : null}
          ${row.empty ? html`<span style="color:var(--error);" title=${row.emptyNote}>✋</span>` : null}
        </div>
        ${row.staleNote ? html`
          <div class="bench-mirror-picker-stale"
               style="margin-left:104px;color:var(--error);font-size:11px;white-space:pre-wrap;">
            ⚠ ${row.staleNote}
          </div>` : null}
        </div>`)}
      ${pickerError.value ? html`
        <div style="color:var(--error);white-space:pre-wrap;margin:10px 0;">
          ✋ ${pickerError.value}
        </div>` : null}
      <div style="display:flex;justify-content:space-between;margin-top:12px;gap:8px;">
        <div>
          <button class="pe-btn" id="bench-mirror-picker-defaults"
                  title=${'Forget the remembered selection for this session: every slot back to ' +
                    'the sidecar\'s default_source and NORMAL pixel order. Staging only — the ' +
                    'remembered file is replaced by the next successful ARM.'}
                  onClick=${() => { pickerDraft.value = pickerDefaults(pickerOptions.value); }}>
            ↺ scene defaults
          </button>
        </div>
        <div>
          <button class="pe-btn" onClick=${closePicker}>Cancel</button>
          <button class="pe-btn" id="bench-mirror-picker-confirm"
                  disabled=${!state.canConfirm || pickerBusy.value}
                  style=${'background:var(--primary);color:var(--surface-container-lowest);' +
                    'border:1px solid var(--primary);'}
                  onClick=${() => confirmPicker(state, scene)}>
            ${state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  `;
}

function BenchMirrorHeaderControl() {
  const bm = benchMirrorControlState(benchMirror.value, { connected: benchLinkUp.value });
  const picking = pickerOptions.value !== null || pickerBusy.value || pickerError.value !== '';
  const scene = bm.armScene;
  return html`
    <span id="cm-bench-mirror-slot" style="display:inline-flex;align-items:center;gap:6px;">
      <span id="cm-bench-mirror-status" title=${bm.title}
            style=${`font-family:var(--font-headline);font-size:11px;letter-spacing:0.04em;` +
              `color:${bm.action === 'disarm' ? 'var(--error)' : 'var(--primary)'};`}>
        ${bm.statusText}
      </span>
      ${bm.noticeText ? html`
        <span id="cm-bench-mirror-notice" title=${bm.title}
              style="font-size:10px;color:var(--secondary);max-width:340px;overflow:hidden;
                     text-overflow:ellipsis;white-space:nowrap;">${bm.noticeText}</span>` : null}
      <button id="cm-bench-mirror-btn" class="pe-btn"
              disabled=${bm.disabled}
              title=${bm.title}
              style=${'padding:2px 8px;' +
                (bm.action === 'disarm'
                  ? 'background:var(--error);color:var(--surface-container-lowest);border:1px solid var(--error);'
                  : 'background:var(--primary);color:var(--surface-container-lowest);border:1px solid var(--primary);') +
                (bm.disabled ? 'opacity:0.45;cursor:not-allowed;' : '')}
              onClick=${() => {
    if (bm.action === 'arm') openPicker(bm.armScene);
    else if (bm.action === 'disarm') runDisarm();
  }}>
        ${bm.buttonLabel}
      </button>
      ${picking && scene ? html`<${BenchMirrorPicker} scene=${scene} />` : null}
    </span>
  `;
}

function ControllerMapPanel() {
  return html`
    <div id="controller-map-panel" class="hidden">
      <div class="vm-header" id="cm-drag-handle">
        <span class="vm-title">🎛 Controller Mapping</span>
        <span id="cm-bench-mirror-host"></span>
        <span class="cm-header-status" id="cm-header-status"></span>
        <button class="pe-btn" id="cm-collapse-btn" title="Collapse">─</button>
      </div>
      <div class="cm-body" id="cm-body"></div>
    </div>
  `;
}

/**
 * Replace the static #controller-map-panel with the Preact-rendered
 * shell. Must run BEFORE setupControllerMapEditor(), so the legacy code
 * finds the ids. Mounted once into a host appended to document.body —
 * same stacking context as the static markup (the panel is
 * position:fixed).
 */
export function initModernControllerMapShell() {
  const legacyEl = document.getElementById('controller-map-panel');
  if (legacyEl) legacyEl.remove();
  const host = document.createElement('div');
  host.id = 'modern-controller-map-host';
  document.body.appendChild(host);
  render(html`<${ControllerMapPanel} />`, host);

  // The bench-mirror control is its OWN root inside the header slot, so the
  // static shell above stays static and the legacy body keeps handler ownership
  // of everything it already owns.
  const slot = document.getElementById('cm-bench-mirror-host');
  if (slot) render(html`<${BenchMirrorHeaderControl} />`, slot);

  // The bridge pushes `benchMirrorStatus` on every transition and to every new
  // connection; `sacn_input_source.js` parks the latest on `stats.benchMirror`
  // and nulls it when the socket drops. Poll that rather than subscribing, so
  // this module has no coupling to the input source's lifecycle — the same
  // 500 ms cadence the monitors already use.
  setInterval(() => {
    const source = window.sacnInput;
    benchLinkUp.value = !!(source && source.stats && source.stats.connected);
    benchMirror.value = (source && source.stats) ? source.stats.benchMirror : null;
  }, BENCH_MIRROR_POLL_MS);
}
