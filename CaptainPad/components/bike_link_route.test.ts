import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const ROUTE = readFileSync(join(ROOT, 'app', '(tabs)', 'bike_link.tsx'), 'utf8');
const CONFIG = readFileSync(join(ROOT, 'app', '(tabs)', 'config.tsx'), 'utf8');
const LAYOUT = readFileSync(join(ROOT, 'app', '(tabs)', '_layout.tsx'), 'utf8');
const PANEL = readFileSync(join(__dirname, 'BikeColorLinkCard.tsx'), 'utf8');

describe('Bike Link route wiring', () => {
  it('is a guarded Config sub-view whose Config rail remains selected', () => {
    expect(ROUTE).toMatch(/PerformanceRouteGuard routeName="bike_link"/);
    expect(ROUTE).toMatch(/ConfigSubviewFrame routeName="bike_link"/);
    expect(LAYOUT).toMatch(/name="bike_link"/);
  });

  it('lives off the general Config body and enters through Setup Surfaces policy', () => {
    expect(CONFIG).not.toMatch(/BikeColorLinkCard/);
    expect(CONFIG).toMatch(/captainPadSubviewRoutes\('config'\)/);
  });

  it('exposes the required target lifecycle actions and atomic start helper', () => {
    expect(PANEL).toMatch(/SAVE & START/);
    expect(PANEL).toMatch(/SAVE TARGETS/);
    expect(PANEL).toMatch(/STOP LINK/);
    expect(PANEL).toMatch(/startBikeLinkPatch\(targetsDraft\)/);
    expect(PANEL).not.toMatch(/setBikesConfig\(\{\s*enabled:\s*true\s*\}\)/);
  });

  it('shows every supported target form above the editor without real addresses', () => {
    expect(PANEL).toMatch(/TARGET FORMAT EXAMPLES/);
    expect(PANEL).toMatch(/A\.B\.C\.D/);
    expect(PANEL).toMatch(/A\.B\.C\.D:port/);
    expect(PANEL).toMatch(/A\.B\.C\.\[D\.\.\.E\]/);
    expect(PANEL).toMatch(/A\.B\.C\.\[D\.\.\.E\]:port/);
    expect(PANEL).toMatch(/A\.B\.C\.D-A\.B\.C\.E/);
      expect(PANEL).toMatch(/changes are coalesced and pushed at most once per second/);
      expect(PANEL).toMatch(/10-second idle keepalive/);
  });
});
