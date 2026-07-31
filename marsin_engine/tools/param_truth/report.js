// report.js — render a results document as a human-readable markdown table.
//
// Sorted worst-first: WRONG (the knob lies), then DEAD (the knob does nothing),
// then WEAK, then the unfalsifiable names, then everything that checks out.
// Within a class the biggest measured effect comes first — a WRONG parameter
// that moves a lot of light is more urgent than one that barely moves.

import { THRESHOLDS } from './claims.js';
import { VERDICT } from './classify.js';

export const REPORT_ORDER = [VERDICT.WRONG, VERDICT.DEAD, VERDICT.WEAK,
  VERDICT.UNKNOWN_CLAIM, VERDICT.TRUE];

/** Escape a cell so a stray pipe cannot break the markdown table. */
function cell(v) {
  return String(v == null ? '' : v).replace(/\|/g, '\\|');
}

/**
 * Flatten a results document into one row per (pattern, param).
 *
 * @param {object} doc
 * @returns {object[]}
 */
export function flatten(doc) {
  const rows = [];
  for (const p of doc.patterns) {
    for (const name of Object.keys(p.params || {})) {
      rows.push({ pattern: p.pattern, ...p.params[name] });
    }
  }
  return rows;
}

/**
 * Group the actionable verdicts by pattern, for a curator punch-list.
 *
 * @param {object} doc
 * @returns {Map<string, object[]>}
 */
export function punchList(doc) {
  const byPattern = new Map();
  for (const r of flatten(doc)) {
    if (r.verdict !== VERDICT.WRONG && r.verdict !== VERDICT.DEAD) continue;
    if (!byPattern.has(r.pattern)) byPattern.set(r.pattern, []);
    byPattern.get(r.pattern).push(r);
  }
  return byPattern;
}

/**
 * Render the full markdown report.
 *
 * @param {object} doc — results document.
 * @param {Record<string, number>} counts — tally() output.
 * @returns {string}
 */
export function renderMarkdown(doc, counts) {
  const rows = flatten(doc);
  rows.sort((a, b) => {
    const ra = REPORT_ORDER.indexOf(a.verdict);
    const rb = REPORT_ORDER.indexOf(b.verdict);
    if (ra !== rb) return ra - rb;
    return b.effectScore - a.effectScore;
  });

  const lines = [];
  lines.push('# Parameter truth sweep');
  lines.push('');
  lines.push(`Model \`${doc.model}\` (${doc.pixelCount} px) · ${doc.frames} frames after `
    + `${doc.warmupFrames} warmup · sweep points ${doc.sweepPoints.join(', ')}`);
  lines.push('');
  lines.push(`Patterns swept ${counts.patternsOk} · compile errors `
    + `${counts.patternsCompileError} · no params ${counts.patternsNoParams} · `
    + `params measured ${counts.paramTotal}`);
  lines.push('');
  lines.push('| Class | Count |');
  lines.push('|---|---:|');
  for (const v of REPORT_ORDER) lines.push(`| ${v} | ${counts[v]} |`);
  lines.push('');
  lines.push('## Thresholds');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(THRESHOLDS, null, 2));
  lines.push('```');
  lines.push('');

  const compileErrors = doc.patterns.filter(p => p.status === 'COMPILE_ERROR');
  if (compileErrors.length > 0) {
    lines.push('## Patterns that do not compile on this model');
    lines.push('');
    lines.push('| Pattern | Error |');
    lines.push('|---|---|');
    for (const p of compileErrors) lines.push(`| \`${p.pattern}\` | ${cell(p.error)} |`);
    lines.push('');
  }

  if (doc.crossModel && counts.deadButAliveOnCrossModel > 0) {
    lines.push(`## DEAD on \`${doc.model}\` but ALIVE on \`${doc.crossModel.model}\``);
    lines.push('');
    lines.push('These controls are wired correctly. The code path they drive is not '
      + `reachable on \`${doc.model}\` — usually a \`sectionId\` / \`fixtureType\` gate `
      + 'the show model does not satisfy. Fix the model coverage or the gate, not the '
      + 'slider.');
    lines.push('');
    lines.push('| Pattern | Param | Verdict elsewhere | Effect elsewhere |');
    lines.push('|---|---|---|---:|');
    for (const r of rows) {
      if (r.verdict !== VERDICT.DEAD || !r.crossModel || !r.crossModel.verdict) continue;
      if (r.crossModel.verdict === VERDICT.DEAD) continue;
      lines.push(`| \`${r.pattern}\` | \`${r.control}\` | ${r.crossModel.verdict} `
        + `| ${r.crossModel.effectScore} |`);
    }
    lines.push('');
  }

  const punch = punchList(doc);
  if (punch.size > 0) {
    lines.push('## Punch-list by pattern (WRONG + DEAD)');
    lines.push('');
    const ordered = [...punch.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [pattern, items] of ordered) {
      lines.push(`- \`${pattern}\` — ${items.length}: `
        + items.map(i => `\`${i.control}\` (${i.verdict})`).join(', '));
    }
    lines.push('');
  }

  lines.push('## Findings, worst first');
  lines.push('');
  lines.push('| Verdict | Pattern | Param | Family | Effect | Reason | Evidence |');
  lines.push('|---|---|---|---|---:|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.verdict} | \`${r.pattern}\` | \`${r.control}\` | ${r.family} `
      + `| ${r.effectScore.toFixed(4)} | ${cell(r.reason)} | ${cell(r.detail)} |`);
  }
  lines.push('');
  return lines.join('\n');
}
