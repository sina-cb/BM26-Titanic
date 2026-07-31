/*
  lua_action_string.cjs — the PURE Lua→device action-string compiler.

  Split out of grid_serial.cjs (2026-07-28, report _30 fix plan step 4) for one
  reason: grid_serial.cjs requires `serialport`, a NATIVE addon. The offline
  budget/line-ending regression test must exercise this compile pipeline from
  the engine's own `npm test`, and loading a native serial addon into the test
  runner would import exactly the crash surface the VSN1 architecture keeps
  isolated in short-lived CLI children (report _30 §1/§3). Everything here is
  string transformation over `@intechstudio/grid-protocol` — zero I/O, zero
  device contact, zero native code.

  grid_serial.cjs re-exports every symbol below, so all existing callers
  (deploy_layout.cjs, write_config.cjs, restore_config.cjs, …) are unchanged.

  The caller must have awaited `initLuaFormatter()` on the grid-protocol module
  before calling buildActionStringFromLua — the minifier is WASM-backed.
*/
'use strict';

// ── Action-string building & validation ──────────────────────────────────────
// The device stores single-line short-form strings wrapped `<?lua ... ?>`.
// GridScript.humanize maps that to `<lua ... >`; shortify maps names back but
// keeps the `<lua ... >` wrapper — so we restore `<?lua ... ?>` ourselves.
// This exact transform round-trips all 45 factory page-0 action strings.
function toDeviceActionString(gp, humanWrapped) {
  const short = gp.GridScript.shortify(humanWrapped);
  if (!short.startsWith('<lua ') || !short.endsWith('>')) {
    throw new Error(
      `shortify produced an unexpected wrapper (want "<lua ... >"): ` +
        `${short.slice(0, 60)}...`,
    );
  }
  return `<?lua ${short.slice(5, -1).trimEnd()} ?>`;
}

function toHumanActionString(gp, deviceShort) {
  return gp.GridScript.humanize(deviceShort);
}

// Strip `--` line comments (to end of line) while keeping `--[[ ... ]]` block
// comments (the protocol's action-block markers). Limitation: a literal "--"
// inside a Lua string would be treated as a comment — our templates avoid
// that, and the syntax check below fails loudly if stripping breaks the code.
//
// LINE ENDINGS (RCA 2026-07-28, report _30 §2): this used to split on '\n'
// only. On a CRLF file every line then ended in '\r', and `/--(?!\[\[).*$/`
// can NEVER match there — `.` does not cross a `\r` (it is a line terminator
// to the regex engine) and `$` without `/m` only anchors at end-of-string. So
// on a CRLF checkout NOT ONE comment was stripped: the whole template rode
// into minify and the encoder INIT action string ballooned 904 → 5960 chars,
// blowing the 909-char device CONFIG_LENGTH on every single deploy. The repo
// has core.autocrlf=true, so any checkout/branch-switch materialized the
// templates as CRLF. Splitting on /\r?\n/ makes CRLF harmless forever (the
// trimEnd() below already absorbs a stray '\r'); .gitattributes pins the
// templates to LF so the drift class cannot come back.
function stripLineComments(luaSource) {
  return luaSource
    .split(/\r?\n/)
    .map((line) => line.replace(/--(?!\[\[).*$/, '').trimEnd())
    .join('\n');
}

// A `--` line-comment opener that is NOT a `--[[` block marker. Applied to the
// SINGLE-LINE minified string, where such an opener would comment out the
// ENTIRE REST OF THE SCRIPT (see buildActionStringFromLua).
const SURVIVING_LINE_COMMENT_RE = /--(?!\[\[)/;

// Compile a human-readable Lua FILE body into a device action string:
// strip line comments -> minify -> require single line -> comment-survival
// guard -> syntax check -> wrap as a code-block action -> shortify -> device
// `<?lua ... ?>` form. Fails loudly at every stage. Requires
// initLuaFormatter() already awaited.
function buildActionStringFromLua(gp, luaSource, maxLength) {
  const { GridScript } = gp;

  const stripped = stripLineComments(luaSource);
  const minified = GridScript.minifyScript(stripped).replace(/\n+/g, ' ').trim();
  if (minified.length === 0) {
    throw new Error('Lua source is empty after comment stripping + minification.');
  }
  if (/\n/.test(minified)) {
    throw new Error('Minified Lua still contains newlines; action strings must be single-line.');
  }
  // FAIL-LOUD COMMENT-SURVIVAL GUARD (report _30 §2.7, fix plan step 2).
  // Everything above collapses the script to ONE line, so a `--` line comment
  // that survived stripping does not just bloat the string — it comments out
  // the ENTIRE REST OF THE SCRIPT. And `checkSyntax` still PASSES, because a
  // comment is valid Lua: we would flash semantically dead code with green
  // lights and no error anywhere. The CRLF bug above was only caught because
  // the un-stripped comments happened to blow the size budget; a shorter
  // template would have shipped silently broken. This guard makes that whole
  // regression class (line-ending drift, a minifier change that stops
  // stripping, a new comment syntax) unshippable instead of silent. `--[[`
  // block markers are the protocol's action-block syntax and stay legal.
  if (SURVIVING_LINE_COMMENT_RE.test(minified)) {
    const at = minified.search(SURVIVING_LINE_COMMENT_RE);
    throw new Error(
      `line comment survived comment stripping — refusing to flash (would ` +
        `comment out the rest of the script). At offset ${at}: ` +
        `"${minified.slice(Math.max(0, at - 30), at + 40)}"`,
    );
  }
  if (!GridScript.checkSyntax(minified)) {
    throw new Error(
      'Lua syntax check failed after minification. If your source has "--" ' +
        'inside a string literal, remove it — line-comment stripping cannot ' +
        'distinguish it.',
    );
  }

  // Wrap as a single code-block action (the --[[@cb]] marker, as used by the
  // factory config), then map to the short/device form.
  const device = toDeviceActionString(gp, `<lua --[[@cb]] ${minified} >`);

  if (device.length > maxLength) {
    throw new Error(
      `Action string is ${device.length} chars; device limit is ${maxLength} ` +
        `(grid CONFIG_LENGTH). Shorten the Lua.`,
    );
  }
  return device;
}

module.exports = {
  SURVIVING_LINE_COMMENT_RE,
  toDeviceActionString,
  toHumanActionString,
  stripLineComments,
  buildActionStringFromLua,
};
