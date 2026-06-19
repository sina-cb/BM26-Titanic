/*
  gen_catalog.mjs — render the multi-page pattern catalog from catalog_data.json.
  DEV/DOC TOOL ONLY (Node built-ins, no deps).

  Produces, under marsin_engine/patterns/:
    catalog.md              — the INDEX page (intro, legend, links to every group)
    catalog/<NN-NN>.md      — one GROUP page per 5 patterns, each pattern shown
                              with its test_bench preview GIF (patterns/gifs/NN.gif)
                              and metrics, plus Index / Prev / Next nav.

  SOURCE OF TRUTH is catalog_data.json (one entry per pattern, ordered). Curate
  that + regenerate to maintain the catalog. The preview GIFs are produced
  separately by tools/gen_pattern_gifs.mjs. See the spec:
  .agent/00_gol/15_pattern_catalog.md.

  Usage (from marsin_engine/):  node tools/gen_catalog.mjs
*/
import fs from 'fs';
import path from 'path';
import url from 'url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const PATTERNS_DIR = path.resolve(HERE, '..', 'patterns');
const DATA_PATH = path.join(PATTERNS_DIR, 'catalog_data.json');
const GROUP_DIR = path.join(PATTERNS_DIR, 'catalog');
const GROUP_SIZE = 5;

const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

// chunk into ordered groups of GROUP_SIZE
const groups = [];
for (let i = 0; i < data.length; i += GROUP_SIZE) groups.push(data.slice(i, i + GROUP_SIZE));
const fileOf = g => g[0].num + '-' + g[g.length - 1].num + '.md';
const rangeOf = g => g[0].num + '–' + g[g.length - 1].num;

// ── intro / legend / summary (curated prose; lives on the index) ──────────────
const INTRO = `# Pattern Catalog — \`marsin_engine/patterns/\`

Status of every top-level show pattern: a **test_bench preview GIF**, identity,
brightness/audio metrics, cross-model coverage, and remaining issues. This is a
multi-page catalog: this page is the index, and each linked page below covers a
group of ${GROUP_SIZE} patterns with their animated previews.

**Patterns 00–25 are now updated and high-def** — they went through the full
ground-rule + white tuning pass (high-def brightness, audio-reactive PRIMARY,
two-colour, silence-safe, light every rig). Patterns 26–58 are the HD batch;
several still need that pass (see each group's status + the worklist below).

**How this is built (for the next agent):** the source of truth is
\`catalog_data.json\` (one entry per pattern). Edit it and run
\`node tools/gen_catalog.mjs\` to regenerate this index + the group pages. The
preview GIFs come from \`node tools/gen_pattern_gifs.mjs\` (test_bench widget
layout → \`patterns/gifs/NN.gif\`). Full spec:
\`.agent/00_gol/15_pattern_catalog.md\`.

**Gate thresholds** (skill \`12_highdef_pattern_generation.md\` §0): \`peak ≥ 200\`
(high-def brightness), PRIMARY \`micLow→brightness corr ≥ 0.5\` (audio-reactive),
\`hueSpread ≥ 0.10\` (two colours), lights every rig, silence-safe. \`peak\`/\`corr\`
measured on **test_bench**; \`titanic\` = pixels lit / 970. Kick-gated patterns
(heartbeat/dancers/swipe) react via kick/position, so a low \`corr\` there is *by
design*.`;

const LEGEND = `## Legend (batch B status)
🔴 dim (\`peak<200\`) · 🔵 weak audio (\`corr<0.5\`, not kick-gated) · 🟣 \`hueSpread<0.10\` · ⚫ near-dark/broken · 🟢 meets bars.`;

const SUMMARY = `## Summary
- **00–25:** production-ready (tuned + white + cross-model) — updated & high-def.
- **26–58:** lights every rig, but several patterns still miss the brightness/audio
  bars and need the same ground-rule pass. The per-group status flags the worklist.
- Cross-model ④/⑤ items + the \`23\` dark-space decision are tracked in Notion.

*(No 55/56 in the top dir — the sequence is 00–54, 57, 58.)*`;

// ── index page ────────────────────────────────────────────────────────────────
let index = INTRO + '\n\n## Pages\n\n';
for (const g of groups) {
  const names = g.map(p => '`' + p.num + '`').join(' ');
  index += '- [Patterns ' + rangeOf(g) + '](catalog/' + fileOf(g) + ') — ' +
    g.map(p => p.name).join(', ') + '\n';
}
index += '\n' + LEGEND + '\n\n' + SUMMARY + '\n';
fs.writeFileSync(path.join(PATTERNS_DIR, 'catalog.md'), index);

// ── group pages ───────────────────────────────────────────────────────────────
fs.mkdirSync(GROUP_DIR, { recursive: true });
function nav(i) {
  const parts = ['[🏠 Index](../catalog.md)'];
  if (i > 0) parts.push('[⬅ Prev (' + rangeOf(groups[i - 1]) + ')](' + fileOf(groups[i - 1]) + ')');
  if (i < groups.length - 1) parts.push('[Next (' + rangeOf(groups[i + 1]) + ') ➡](' + fileOf(groups[i + 1]) + ')');
  return parts.join(' · ');
}
function patternBlock(p) {
  let s = '### `' + p.num + '_' + p.name + '`\n\n';
  s += '<img src="../gifs/' + p.num + '.gif" width="384" alt="' + p.num + '_' + p.name + ' preview (test_bench)">\n\n';
  s += '**Identity:** ' + p.identity + '  \n';
  const metrics = [];
  if (p.peak !== null && p.peak !== undefined) metrics.push('**peak** ' + p.peak);
  if (p.corr !== null && p.corr !== undefined) metrics.push('**corr** ' + p.corr);
  metrics.push('**titanic** ' + p.titanic + '/970 lit');
  s += metrics.join(' · ') + '  \n';
  s += '**Status:** ' + p.status + '\n';
  return s;
}
for (let i = 0; i < groups.length; i++) {
  const g = groups[i];
  let page = '# Patterns ' + rangeOf(g) + '\n\n' + nav(i) + '\n\n---\n\n';
  page += g.map(patternBlock).join('\n---\n\n');
  page += '\n\n---\n\n' + nav(i) + '\n';
  fs.writeFileSync(path.join(GROUP_DIR, fileOf(g)), page);
}

console.log('catalog: index + ' + groups.length + ' group page(s) [' +
  groups.map(rangeOf).join(', ') + '] -> ' + PATTERNS_DIR);
