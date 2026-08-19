import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = fs.readFileSync(path.join(__dirname, 'GlobalEffectMacros.tsx'), 'utf8');

describe('GlobalEffectMacros Performance wiring', () => {
  it('derives trigger-only presentation from raw Performance mode', () => {
    expect(SOURCE).toContain('const performanceModeActive = usePerformanceMode().active;');
    expect(SOURCE).toContain('const performanceModeReady = usePerformanceModeReady();');
    expect(SOURCE).toContain(
      'effectSurfacePolicy(performanceModeActive, performanceModeReady)',
    );
  });

  it('removes configuration affordances from layout while preserving slot fire', () => {
    expect(SOURCE).toContain("display: configurationVisible ? 'flex' : 'none'");
    expect(SOURCE).toContain('configurationVisible && (hasIntensity || hasMode)');
    expect(SOURCE).toContain('open={configurationVisible && detailOpen}');
    expect(SOURCE).toContain('slotId={surfacePolicy.configurationVisible ? swapTargetId : null}');
    expect(SOURCE).toContain('onPress={() => onPressSlot(slot)}');
  });

  it('renders empty slots inert rather than as add-effect buttons', () => {
    expect(SOURCE).toContain('if (!configurationVisible) {');
    expect(SOURCE).toContain('return <View pointerEvents="none" style={{ ...sizing, height }} />;');
  });

  it('removes the touch BLACKOUT control from Performance layout', () => {
    expect(SOURCE).toContain('const blackoutCell = surfacePolicy.showBlackout ? (');
    expect(SOURCE).toContain('{surfacePolicy.showBlackout ? (');
    expect(SOURCE).toContain('...(surfacePolicy.showBlackout');
  });
});
