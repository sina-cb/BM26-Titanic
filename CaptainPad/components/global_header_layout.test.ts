import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import type { Yoga as YogaModule } from 'yoga-layout/load';

import {
  HEADER_COMPACT_MAX_WIDTH,
  HEADER_MASTER_FADER_COMPACT_WIDTH,
  HEADER_MASTER_FADER_WIDE_WIDTH,
  HEADER_MODEL_MIN_WIDTH,
} from '@/constants/header_layout';

const SIDEBAR_WIDTH = 112;
const IPAD_LANDSCAPE_WIDTH = 1366;
const DESKTOP_WIDTH = 1920;

let Yoga: YogaModule;

beforeAll(async () => {
  Yoga = await loadYoga();
});

interface HeaderMeasure {
  headerRight: number;
  rackRight: number;
  masterRight: number;
  modelWidth: number;
}

function measureHeader(screenWidth: number, compact: boolean): HeaderMeasure {
  const headerWidth = screenWidth - SIDEBAR_WIDTH;
  const horizontalPadding = compact ? 16 : 24;

  const header = Yoga.Node.create();
  header.setWidth(headerWidth);
  header.setPadding(Yoga.EDGE_HORIZONTAL, horizontalPadding);
  header.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  header.setAlignItems(Yoga.ALIGN_CENTER);
  header.setJustifyContent(Yoga.JUSTIFY_SPACE_BETWEEN);

  const identity = Yoga.Node.create();
  identity.setFlexGrow(1);
  identity.setFlexShrink(1);
  identity.setFlexBasis(0);
  identity.setMinWidth(0);
  identity.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  identity.setGap(Yoga.GUTTER_COLUMN, compact ? 8 : 12);

  const identityWidths = [165, 122];
  identityWidths.forEach((width) => {
    const child = Yoga.Node.create();
    child.setWidth(width);
    identity.insertChild(child, identity.getChildCount());
  });

  const model = Yoga.Node.create();
  model.setWidth(compact ? 168 : 208);
  model.setMinWidth(HEADER_MODEL_MIN_WIDTH);
  model.setFlexShrink(0);
  identity.insertChild(model, identity.getChildCount());

  [88, 44].forEach((width) => {
    const child = Yoga.Node.create();
    child.setWidth(width);
    identity.insertChild(child, identity.getChildCount());
  });

  const rack = Yoga.Node.create();
  rack.setFlexShrink(0);
  rack.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  rack.setAlignItems(Yoga.ALIGN_CENTER);
  rack.setGap(Yoga.GUTTER_COLUMN, compact ? 8 : 12);
  rack.setPadding(Yoga.EDGE_HORIZONTAL, compact ? 6 : 8);

  const fade = Yoga.Node.create();
  fade.setWidth(compact ? 218 : 334);
  rack.insertChild(fade, 0);

  const master = Yoga.Node.create();
  master.setFlexShrink(0);
  master.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  master.setGap(Yoga.GUTTER_COLUMN, compact ? 6 : 8);
  master.setPadding(Yoga.EDGE_LEFT, compact ? 8 : 12);

  [46, compact ? HEADER_MASTER_FADER_COMPACT_WIDTH : HEADER_MASTER_FADER_WIDE_WIDTH, 44]
    .forEach((width) => {
      const child = Yoga.Node.create();
      child.setWidth(width);
      master.insertChild(child, master.getChildCount());
    });
  rack.insertChild(master, 1);

  header.insertChild(identity, 0);
  header.insertChild(rack, 1);
  header.calculateLayout(headerWidth, undefined, Yoga.DIRECTION_LTR);

  const result = {
    headerRight: headerWidth - horizontalPadding,
    rackRight: rack.getComputedLeft() + rack.getComputedWidth(),
    masterRight: rack.getComputedLeft() + master.getComputedLeft() + master.getComputedWidth(),
    modelWidth: model.getComputedWidth(),
  };
  header.freeRecursive();
  return result;
}

describe('prestige global header — Yoga-executed bounds', () => {
  it('selects the compact control grammar for the 1366pt iPad, not desktop', () => {
    expect(IPAD_LANDSCAPE_WIDTH).toBeLessThanOrEqual(HEADER_COMPACT_MAX_WIDTH);
    expect(DESKTOP_WIDTH).toBeGreaterThan(HEADER_COMPACT_MAX_WIDTH);
  });

  it.each([
    ['iPad landscape', IPAD_LANDSCAPE_WIDTH, true],
    ['desktop', DESKTOP_WIDTH, false],
  ] as const)('keeps MODEL and the complete MASTER group inside the %s rack', (_name, width, compact) => {
    const measured = measureHeader(width, compact);
    expect(measured.modelWidth).toBeGreaterThanOrEqual(HEADER_MODEL_MIN_WIDTH);
    expect(measured.masterRight).toBeLessThanOrEqual(measured.rackRight);
    expect(measured.rackRight).toBeLessThanOrEqual(measured.headerRight);
  });
});

describe('prestige global header — shipped source guards', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const deck = readFileSync(join(here, 'DeckTopBar.tsx'), 'utf8');
  const fade = readFileSync(join(here, 'MasterFadeGroup.tsx'), 'utf8');
  const midi = readFileSync(join(here, 'MidiStatusChip.tsx'), 'utf8');
  const midiLabel = readFileSync(join(here, 'midi_chip_label.ts'), 'utf8');

  it('keeps MODEL horizontal and switches the fade selector at the shared breakpoint', () => {
    expect(deck).toMatch(/compactHeader\s*=\s*isPortrait\s*\|\|\s*width\s*<=\s*HEADER_COMPACT_MAX_WIDTH/);
    expect(deck).toMatch(/<Text numberOfLines=\{1\} style=\{styles\.modelLabel\}>MODEL<\/Text>/);
    expect(deck).toMatch(/<MasterFadeGroup[\s\S]{0,120}compact=\{compactHeader\}/);
  });

  it('bounds MASTER as one group and keeps every important control label to one line', () => {
    const masterGroupAt = deck.indexOf('<View style={[styles.masterControlGroup,');
    const masterValueAt = deck.indexOf('Math.round(master * 100)');
    const valueSingleLineAt = deck.lastIndexOf('numberOfLines={1}', masterValueAt);
    expect(masterGroupAt).toBeGreaterThan(0);
    expect(masterValueAt).toBeGreaterThan(masterGroupAt);
    expect(valueSingleLineAt).toBeGreaterThan(masterGroupAt);
    expect(deck).toMatch(/<Text numberOfLines=\{1\} style=\{styles\.labelCaps\}>MASTER<\/Text>/);
    expect(fade).toMatch(/numberOfLines=\{1\} style=\{styles\.labelCaps\}>FADE<\/Text>/);
    expect(fade).toMatch(/numberOfLines=\{1\} style=\{styles\.fadeActionText\}>TO BLACK<\/Text>/);
    expect(fade).toMatch(/numberOfLines=\{1\} style=\{styles\.fadeActionText\}>UP<\/Text>/);
    // The MIDI header chip is CONTROLLER-NEUTRAL (2026-08-20 operator ask):
    // it labels a joint state across APC + MFT + VSN1, so the compile-time
    // text is `🎹 MIDI`, not `🎹 APC`. Runtime injects the connected count
    // when 2+ controllers are up — see `midi_chip_label.ts` for the pure
    // logic; `MidiStatusChip.tsx` renders `{label}` from it and imports the
    // helper by that path.
    expect(midi).toMatch(/numberOfLines=\{1\}[\s\S]{0,80}\{label\}<\/Text>/);
    expect(midi).toMatch(/from ['"]@\/components\/midi_chip_label['"]/);
    expect(midiLabel).toMatch(/return\s+['"]🎹 MIDI['"]/);
    // …and the label file's EXECUTABLE code must NOT bake in any
    // controller-specific name — that regression is the exact bug this
    // suite is meant to catch. Strip comments first so the module's own
    // header (which names APC + MFT + VSN1 as context) doesn't count.
    const midiLabelCode = midiLabel
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(midiLabelCode).not.toMatch(/APC|Midi Fighter|MFT|VSN1/);
  });
});
