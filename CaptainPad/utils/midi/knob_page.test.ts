import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { KNOB_PAGE_GLOBALS, deriveKnobPage, globalKnobNumber } from './knob_page';
import { LOCAL_PARAM_KNOB_COUNT, LOCAL_PARAM_KNOB_OFFSET, Export } from './knob_order';
import { validateProfile } from './profile';

describe('knob_page (the ONE on-screen first-page model)', () => {
  it('row 0: knob 1 SPEED, knob 2 HUE, knobs 3-4 unassigned, encoders 0-3', () => {
    expect(KNOB_PAGE_GLOBALS).toHaveLength(4);
    expect(KNOB_PAGE_GLOBALS[0]).toEqual({ encoder: 0, knobNumber: 1, assignment: 'speed', label: 'SPEED' });
    expect(KNOB_PAGE_GLOBALS[1]).toEqual({ encoder: 1, knobNumber: 2, assignment: 'hue', label: 'HUE' });
    expect(KNOB_PAGE_GLOBALS[2]).toMatchObject({ encoder: 2, knobNumber: 3, assignment: 'unassigned' });
    expect(KNOB_PAGE_GLOBALS[3]).toMatchObject({ encoder: 3, knobNumber: 4, assignment: 'unassigned' });
  });

  it('globalKnobNumber resolves the badge numbers the canonical controls wear', () => {
    // The on-screen "KNOB N" badges (CPCControls SPEED, the hue controls) read
    // these — a layout change here must re-label them, never a stale literal.
    expect(globalKnobNumber('speed')).toBe(1);
    expect(globalKnobNumber('hue')).toBe(2);
  });

  it('locals ride the shared knob_order derivation (offset + 12-slot cap)', () => {
    const exps: Export[] = Array.from({ length: 14 }, (_, i) => ({ id: i, name: `p${i}`, kind: 1, v0: 0.5 }));
    const page = deriveKnobPage(exps);
    expect(page.locals.knobMapped).toHaveLength(LOCAL_PARAM_KNOB_COUNT);
    // Globals occupy encoders 0..OFFSET-1; local i lives on encoder i+OFFSET —
    // the two halves tile the 16-knob page with no gap and no overlap.
    expect(KNOB_PAGE_GLOBALS[KNOB_PAGE_GLOBALS.length - 1].encoder).toBe(LOCAL_PARAM_KNOB_OFFSET - 1);
    expect(KNOB_PAGE_GLOBALS.length + LOCAL_PARAM_KNOB_COUNT).toBe(16);
  });

  it('NEVER drifts from the shipped mft.yaml (encoders pinned to the hardware profile)', () => {
    const raw = yaml.load(readFileSync(join(__dirname, '../../midi_profiles/mft.yaml'), 'utf8'));
    const p = validateProfile(raw, 'mft.yaml');
    // speed: the paramCenterRelative 'speed' control sits on the model's speed encoder.
    const speed = p.controls.find((c) => c.action.kind === 'paramCenterRelative' && c.action.key === 'speed')!;
    expect(speed.match.type === 'cc' && speed.match.cc).toBe(KNOB_PAGE_GLOBALS[0].encoder);
    // hue: the globalHueKnob control sits on the model's hue encoder.
    const hue = p.controls.find((c) => c.action.kind === 'globalHueKnob')!;
    expect(hue.match.type === 'cc' && hue.match.cc).toBe(KNOB_PAGE_GLOBALS[1].encoder);
    // unassigned encoders carry NO control in the profile.
    for (const slot of KNOB_PAGE_GLOBALS.filter((s) => s.assignment === 'unassigned')) {
      expect(p.controls.find((c) => c.match.type === 'cc' && c.match.channel === 0 && c.match.cc === slot.encoder)).toBeUndefined();
    }
    // locals: the profile maps exactly LOCAL_PARAM_KNOB_COUNT focusedParamKnob
    // controls, starting right after the globals row.
    const locals = p.controls.filter((c) => c.action.kind === 'focusedParamKnob');
    expect(locals).toHaveLength(LOCAL_PARAM_KNOB_COUNT);
    const localCCs = locals.map((c) => (c.match.type === 'cc' ? c.match.cc : -1)).sort((a, b) => a - b);
    expect(localCCs[0]).toBe(LOCAL_PARAM_KNOB_OFFSET);
    expect(localCCs[localCCs.length - 1]).toBe(15);
  });
});
