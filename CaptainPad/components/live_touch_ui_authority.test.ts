import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOUCH_HTML = readFileSync(join(HERE, '..', '..', 'docs', 'ui', 'touch_control.html'), 'utf8');
const TOUCH_WIRE = readFileSync(join(HERE, '..', '..', 'docs', 'ui', 'touch_control_wire.js'), 'utf8');
const CPC = readFileSync(join(HERE, 'CPCControls.tsx'), 'utf8');
const DECK = readFileSync(join(HERE, '..', 'app', '(tabs)', 'index.tsx'), 'utf8');
const MIXER = readFileSync(join(HERE, '..', 'app', '(tabs)', 'mixer.tsx'), 'utf8');

const markup = TOUCH_HTML.match(/<body[\s\S]*?<script>/)?.[0] ?? '';

describe('Live Touch professional workspace contract', () => {
  it('removes local utility, tempo, and per-panel chrome from the shipped markup', () => {
    expect(markup).not.toBe('');
    for (const id of [
      'settingsBtn',
      'reloadPanel',
      'helpToggle',
      'statusBtn',
      'bpmSync',
      'bpmVal',
      'bpmMinus',
      'bpmPlus',
      'patternCaps',
      'panelRail',
    ]) {
      expect(markup).not.toMatch(new RegExp(`id=["']${id}["']`));
    }
    expect(markup).not.toMatch(/\sdata-lock(?:=|\s|>)/);
    expect(markup).not.toMatch(/\sdata-collapse(?:=|\s|>)/);
    expect(markup).not.toContain('data-caps');
    expect(TOUCH_WIRE).not.toContain('dataset.caps');
  });

  it('keeps ARM and the pattern chooser, then puts workspace visibility above the mounted panels', () => {
    expect(markup).toMatch(/id="arm"[^>]*role="switch"/);
    expect(markup).toMatch(/id="patternSel"/);
    expect(markup).toMatch(/<nav class="workspace-bar"/);
    expect(markup.indexOf('id="workspaceBar"')).toBeLessThan(markup.indexOf('<div class="workspace"'));
    expect(TOUCH_HTML).toContain("var LAYOUT_KEY = 'bm26_touch_layout_v2'");
    expect(TOUCH_HTML).toContain("chip.className = 'workspace-chip '");
    expect(TOUCH_HTML).toContain("var isFloor = open && !isBar && openCount() === MIN_OPEN");
  });

  it('renders effect actions as real stateful buttons with a separate edit hatch', () => {
    expect(markup).toMatch(/id="fxEditToggle"[^>]*>EDIT<\/button>/);
    expect(TOUCH_HTML).toMatch(/<button type="button" class="fx-face"[^>]*aria-pressed="false"/);
    expect(TOUCH_HTML).toContain("fxEditToggle.textContent = editing ? 'DONE' : 'EDIT'");
    expect(TOUCH_HTML).toContain("face.setAttribute('aria-pressed', String(on))");
  });
});

describe('shared BPM authority', () => {
  it('leaves all tempo ownership in the shared Deck/Mixer control contract', () => {
    expect(TOUCH_WIRE).not.toContain('/mixer/tempo');
    expect(TOUCH_WIRE).not.toContain('/mixer/tempo/source');
    expect(CPC).toContain('useTempoState');
    expect(CPC).toContain('useTempoTap');
    expect(DECK).toMatch(/<CPCControls\b/);
    expect(MIXER).toMatch(/<CPCControls\b/);
  });
});
