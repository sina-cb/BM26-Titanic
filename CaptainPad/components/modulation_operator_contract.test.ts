import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const modulationSource = fs.readFileSync(path.resolve(__dirname, 'Modulation.tsx'), 'utf8');
const allPanelSource = fs.readFileSync(path.resolve(__dirname, 'AllModulationsPanel.tsx'), 'utf8');

describe('modulation operator controls', () => {
  it('gives the inline remove control its own bounded touch seat and reports failures', () => {
    expect(modulationSource).toContain('const [clearBusy, setClearBusy] = useState(false)');
    expect(modulationSource).toContain("opError('Modulation not removed'");
    expect(modulationSource).toContain('minWidth: 28');
    expect(modulationSource).toContain('hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}');
  });

  it('keeps every variable-height playlist entry mounted on native iPad', () => {
    expect(allPanelSource).toContain('removeClippedSubviews={false}');
    expect(allPanelSource).toContain('LOADING ALL MODULATIONS...');
    expect(allPanelSource).toContain('MODULATIONS UNAVAILABLE');
  });

  it('reports failed row and bulk removal instead of pretending the list refreshed', () => {
    expect(allPanelSource).toContain("opError('Modulation not removed'");
    expect(allPanelSource).toContain("opError('Modulations not cleared'");
  });

  it('presents the editor as a responsive live signal instrument', () => {
    expect(modulationSource).toContain('AUDIO MODULATOR');
    expect(modulationSource).toContain('viewportWidth - 80');
    expect(modulationSource).toContain('% LIVE');
    expect(modulationSource).toContain('SAVE MAPPING');
  });
});
