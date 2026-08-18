import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIO = readFileSync(join(HERE, '..', '..', 'app', '(tabs)', 'audio.tsx'), 'utf8');
const POLICY = readFileSync(join(HERE, '..', '..', 'utils', 'captainpad_tab_policy.ts'), 'utf8');

function functionBody(name: string, nextName: string): string {
  const start = AUDIO.indexOf(`function ${name}`);
  const end = nextName ? AUDIO.indexOf(`function ${nextName}`, start + 1) : AUDIO.length;
  if (start < 0 || end < 0) throw new Error(`could not isolate ${name}`);
  return AUDIO.slice(start, end);
}

describe('Audio native interaction wiring', () => {
  it('enlists the one page scroller in the native fader scroll-lock seam', () => {
    expect(AUDIO).toContain("import { LockableScrollView } from '@/components/ui/lockable_scroll_view';");
    const body = functionBody('AudioConfigBody', '');
    expect(body).toContain('<LockableScrollView');
    expect(body).toContain('</LockableScrollView>');
  });

  it('has no nested vertical ScrollView in the live meter section', () => {
    const meters = functionBody('LiveAudioMeters', 'BpmStaleWarning');
    expect(meters).not.toContain('<ScrollView');
    expect(meters).toContain('width: `${100 / meterColumns}%`');
  });

  it('does not flex-grow signal columns inside the native auto-height grid', () => {
    const start = AUDIO.indexOf('const SignalColumn = React.memo');
    const end = AUDIO.indexOf('function StatusPill', start);
    const signalColumn = AUDIO.slice(start, end);
    expect(signalColumn.match(/<View style=\{\{ width: '100%' \}\}>/g)).toHaveLength(2);
    expect(signalColumn).not.toContain('<View style={{ flex: 1 }}>');
  });

  it('disables both duplicated gain controls while one write is in flight', () => {
    expect(AUDIO).toContain('disabled={inputGainBusy}');
    expect(AUDIO).toContain('inputGainBusy={busy !== null}');
    expect(AUDIO).toContain('disabled={busy !== null}');
  });

  it('serializes full-config mutations so readbacks cannot arrive out of order', () => {
    expect(AUDIO).toContain('const busyRef = useRef<string | null>(null)');
    expect(AUDIO).toContain('if (busyRef.current)');
    expect(AUDIO).toContain('if (!beginMutation(\'input_gain\')) return');
    expect(AUDIO).toContain('if (!beginMutation(\'reset\')) return');
  });
});

describe('Audio authority and lifecycle wiring', () => {
  it('keeps Audio out of Performance without returning a blank Edit body', () => {
    expect(POLICY).toMatch(/audio:\s*\{[^}]*showInPerformance:\s*false/);
    expect(AUDIO).toContain('const bodyState = audioRouteBodyState({');
    expect(AUDIO).toContain("if (bodyState === 'authority_pending') return <AudioAuthorityPending />");
    expect(AUDIO).toContain('CHECKING EDIT AUTHORITY');
    expect(AUDIO).not.toMatch(/function AudioAnalysisScreen\(\)[\s\S]*?<PerformanceRouteGuard/);
  });

  it('reconciles engine audioConfig broadcasts and reconnects through a fresh GET', () => {
    expect(AUDIO).toMatch(/message\.type !== 'audioConfig'/);
    expect(AUDIO).toMatch(/if \(busStatus\.connected\) void reload\(\)/);
  });

  it('parses authoritative config responses for gain, device and reset writes', () => {
    expect(AUDIO).toContain("applyConfigReadback(r.data, 'input gain readback')");
    expect(AUDIO).toContain("applyConfigReadback(r.data, 'capture-device readback')");
    expect(AUDIO).toContain("applyConfigReadback(cfgRes.data, 'reset readback')");
    expect(AUDIO.match(/else \{\s*await reload\(\);\s*\}/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('reconciles a successful config reset even when the parallel chain reset fails', () => {
    const reset = AUDIO.slice(
      AUDIO.indexOf('const resetToDefaults'),
      AUDIO.indexOf('// Software INPUT GAIN'),
    );
    expect(reset.indexOf("if (cfgRes.ok)")).toBeLessThan(reset.indexOf('if (errors.length)'));
    expect(reset).toContain("applyConfigReadback(cfgRes.data, 'reset readback')");
    expect(reset).toContain('if (!configReadbackApplied) await reload()');
  });

  it('turns native API-base rejection into a visible load error', () => {
    const controls = functionBody('AudioAnalysisControls', 'AudioConfigBody');
    expect(controls).toContain('Cannot resolve or load the Audio API');
    expect(controls).toMatch(/catch \(err\)[\s\S]*setLoadError/);
  });
});
