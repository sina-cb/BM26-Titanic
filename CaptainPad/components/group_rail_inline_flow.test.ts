import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const GROUP_RAIL = stripComments(readFileSync(join(HERE, 'GroupRail.tsx'), 'utf8'));

describe('GroupRail stays inside the Mixer GROUPS modal', () => {
  it('uses inline assign and delete panels instead of nested native modals', () => {
    expect(GROUP_RAIL).not.toMatch(/<Modal\b/);
    expect(GROUP_RAIL).not.toMatch(/<ConfirmSheet\b/);
    expect(GROUP_RAIL).toMatch(/assignTo\s*\?\s*\(\s*<View style=\{styles\.pickerPanel\}/);
    expect(GROUP_RAIL).toMatch(/deletePrompt\s*\?\s*\(\s*<View style=\{styles\.confirmPanel\}/);
  });

  it('keeps the assign and delete actions wired to the existing API handlers', () => {
    expect(GROUP_RAIL).toContain('handleAssign(assignTo.id, ch.id)');
    expect(GROUP_RAIL).toContain('void confirmDelete()');
    expect(GROUP_RAIL).toContain('addChannelToGroup(gid, channelId)');
    expect(GROUP_RAIL).toContain('deleteMixGroup(target.id)');
  });
});

describe('GroupRail rename commits on web and native', () => {
  it('wires blur and submit in addition to native end-editing', () => {
    expect(GROUP_RAIL).toMatch(/onEndEditing=\{/);
    expect(GROUP_RAIL).toMatch(/onSubmitEditing=\{/);
    expect(GROUP_RAIL).toMatch(/onBlur=\{/);
    expect(GROUP_RAIL.match(/handleRename\(g\.id, text\)/g)).toHaveLength(3);
  });
});
