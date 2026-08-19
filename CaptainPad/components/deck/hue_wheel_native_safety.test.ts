import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WHEEL_SOURCE = readFileSync(join(HERE, 'hue_wheel.tsx'), 'utf8');
const ICON_SOURCE = readFileSync(join(HERE, '../ui/preset_icon.tsx'), 'utf8');

describe('native COLORS art avoids the crashing RNSVG Fabric mount path', () => {
  it('renders the hue wheel SVG only on web and ordinary Views on native', () => {
    expect(WHEEL_SOURCE).toContain("Platform.OS === 'web' ? (");
    expect(WHEEL_SOURCE).toContain('<NativeHueWheelArt');

    const nativeArt = WHEEL_SOURCE.match(
      /const NativeHueWheelArt = React\.memo\(function NativeHueWheelArt\([\s\S]*?\n\}\);/,
    )?.[0];
    expect(nativeArt).toBeDefined();
    expect(nativeArt).not.toMatch(/<(?:Svg|Path|Circle|Line|G|SvgText)\b/);
    expect(nativeArt).toMatch(/NATIVE_RING_SEGMENTS/);
  });

  it('keeps generated preset icons off RNSVG on native too', () => {
    const nativeBranchAt = ICON_SOURCE.indexOf("if (Platform.OS !== 'web')");
    const svgAt = ICON_SOURCE.indexOf('<Svg');
    expect(nativeBranchAt).toBeGreaterThan(-1);
    expect(svgAt).toBeGreaterThan(nativeBranchAt);
    expect(ICON_SOURCE.slice(nativeBranchAt, svgAt)).not.toMatch(
      /<(?:Svg|Path|Circle)\b/,
    );
  });

  it('retains the SVG artwork for web without exposing it to native', () => {
    expect(WHEEL_SOURCE).toMatch(/<Svg width=\{size\} height=\{size\}/);
    expect(ICON_SOURCE).toMatch(/<Path key=\{i\} d=\{wedgePath/);
  });
});
