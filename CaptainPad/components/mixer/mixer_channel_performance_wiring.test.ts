import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const MIXER_SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'app', '(tabs)', 'mixer.tsx'),
  'utf8',
);

describe('Mixer ChannelStrip Performance wiring', () => {
  it('gates the whole management cluster and its modal from one presentation fact', () => {
    const clusterStart = MIXER_SOURCE.indexOf('{channelPerformance.managementVisible ? (');
    const clusterEnd = MIXER_SOURCE.indexOf(') : null}', clusterStart);
    const cluster = MIXER_SOURCE.slice(clusterStart, clusterEnd);

    expect(clusterStart).toBeGreaterThan(-1);
    expect(cluster).toContain('accessibilityLabel="Move channel up');
    expect(cluster).toContain('accessibilityLabel="Move channel down');
    expect(cluster).toContain('accessibilityLabel="More channel actions"');
    expect(cluster).toContain("onLockToggle(channel.id, !locked)");
    expect(MIXER_SOURCE).toContain(
      'visible={channelPerformance.managementVisible && showActionsMenu}',
    );
  });

  it('routes all per-channel content geometry through the mode-invariant layout', () => {
    expect(MIXER_SOURCE).toContain('const contentLayout = mixerChannelContentLayout({');
    expect(MIXER_SOURCE).toContain('contentLayout.showPortraitPixelBand');
    expect(MIXER_SOURCE).toContain('contentLayout.showLandscapePixelBand');
    expect(MIXER_SOURCE).toContain('contentLayout.forcePixelExpanded ? (');
    expect(MIXER_SOURCE).not.toMatch(/width:\s*PERF_PLAYLIST_COLUMN_WIDTH/);
    expect(MIXER_SOURCE).not.toMatch(/width:\s*PERF_PIXEL_COLUMN_WIDTH/);
  });
});
