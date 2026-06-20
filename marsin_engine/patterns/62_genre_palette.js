/*
  62_genre_palette.js — GENRE-ADAPTIVE palette wash.

  Round-2 audio identity: the engine classifies the party-mode dance genre
  (audioGenre, an index 0..6) with a confidence (audioGenreConf). This pattern
  picks a PALETTE FAMILY from the genre and modulates its saturation/intensity by
  the confidence, so the whole rig dresses itself in the music's mood:

    GENRE_NAMES (genre_classifier.js): 0 ambient · 1 techno · 2 melodic_house ·
      3 deep_house · 4 trance · 5 dnb · 6 downtempo.

    techno      -> dark base, blood RED accents, hard contrast (driving/minimal)
    deep_house  -> warm AMBER/orange, soft, rolling
    melodic/trance -> lush MAGENTA<->CYAN, wide and emotional
    dnb         -> electric GREEN<->violet, fast and punchy
    ambient/downtempo/other -> calm TEAL<->indigo, slow

  The genre index is mapped to a (hue1, hue2) palette pair by a small in-pattern
  table (kept inside the pattern per the brief — no engine helper). audioGenreConf
  scales SATURATION + how far the look commits to the genre colours: low conf =>
  a desaturated neutral teal (we're unsure, stay calm), high conf => the full
  genre palette. A gentle beat-locked wash animates so the rig is alive in silence
  (never fully dark, mission-critical), and when audioParty is off the look holds
  a calm neutral (genre is meaningless outside party mode).

  COORDINATE-DRIVEN (x gradient + radius) so it ports test_bench -> titanic.

  CONTROLS (UI order = declaration order)
    - localSpeed : wash breathing rate (0 = freeze).
    - genre      : GENRE index 0..6 (audio audioGenre /6) -> palette family.
    - genreConf  : GENRE confidence (audio audioGenreConf) -> saturation/commit.
    - party      : PARTY gate (audio audioParty) -> 0 holds calm neutral.
    - level      : overall brightness floor.
    - (no colorPalette exports — the palette is GENRE-DRIVEN, not operator-set.)

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderGenre     <- audioGenre     range 0.00..1.00 curve linear  # HEADLINE: genre index selects the palette family (engine sends genre/6)
    sliderGenreConf <- audioGenreConf range 0.00..1.00 curve linear  # confidence -> saturation + how far we commit to the genre colours
    sliderParty     <- audioParty     range 0.00..1.00 curve linear  # party gate: off => hold a calm neutral (genre is party-only)
  STATIC (operator handles, not audio-mapped): localSpeed, level.
  NOTE: audioGenre is a 0..6 INDEX; the engine OVERRIDE normalises it to 0..1 by
  the slider range — map it with range 0..1 and the pattern rescales *6 internally.
  PALETTE pattern: validate on --synth edm_drop / bassline (audioGenre varies,
  audioParty on). The reactivity is a HUE shift with genre (hueSpread + mean-hue
  change across the clip), plus brightness tracking party/confidence.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // wash breathing rate
export var genre = 0.0;        // GENRE index/6 (audio audioGenre) -> palette family
export var genreConf = 0.0;    // GENRE confidence (audio audioGenreConf) -> saturation
export var party = 0.0;        // PARTY gate (audio audioParty) -> 0 holds calm neutral
export var level = 0.6;        // overall brightness floor

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderGenre(v) { genre = v; }
export function sliderGenreConf(v) { genreConf = v; }
export function sliderParty(v) { party = v; }
export function sliderLevel(v) { level = 0.30 + v * 0.70; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var N_GENRE = 7.0;       // genre indices 0..6
var NEUTRAL_H1 = 0.50;   // calm neutral teal (low conf / no party)
var NEUTRAL_H2 = 0.66;   // calm neutral indigo
var BASE_FLOOR = 0.10;   // always-on floor so the rig never goes fully dark (P0)

// ── Genre -> palette family table (hue pairs, 0..1). Kept IN the pattern. ─────
// index:        0 ambient  1 techno  2 melodic 3 deep_h 4 trance 5 dnb   6 downt
// Each family spans a tight, visually-distinct hue PAIR so the genres separate
// cleanly on the wheel: techno red↔orange (hot/hard), deep_house amber↔gold
// (warm/rolling), melodic magenta↔violet (lush), trance violet↔cyan (wide/
// emotional), dnb green↔lime (electric/fast), ambient/downtempo teal↔indigo
// (calm). The two hues in a pair stay close so each genre reads as ITS colour,
// while different genres land far apart (validated: distinct per-genre meanHue).
// h2 may exceed 1.0 to encode a SHORT-PATH blend across the 1.0/0.0 wrap (e.g.
// techno 0.97 -> 1.04 sweeps red through the wrap to orange, not the long way
// through cyan); hsv2rgb() floors the hue so >1 is fine.
var GEN_H1_0 = 0.50; var GEN_H1_1 = 0.97; var GEN_H1_2 = 0.88; var GEN_H1_3 = 0.07;
var GEN_H1_4 = 0.74; var GEN_H1_5 = 0.30; var GEN_H1_6 = 0.55;
var GEN_H2_0 = 0.62; var GEN_H2_1 = 1.04; var GEN_H2_2 = 0.78; var GEN_H2_3 = 0.13;
var GEN_H2_4 = 0.52; var GEN_H2_5 = 0.42; var GEN_H2_6 = 0.68;
// per-genre saturation ceiling (techno hard, ambient soft)
var GEN_S_0 = 0.7; var GEN_S_1 = 1.0; var GEN_S_2 = 0.95; var GEN_S_3 = 0.9;
var GEN_S_4 = 1.0; var GEN_S_5 = 1.0; var GEN_S_6 = 0.7;

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }

// HSV(h,s,v=1) -> rgb component selectors (v folded in by the caller via `vv`).
// Returns nothing; writes the module-level rr/gg/bb.
var rr = 0, gg = 0, bb = 0;
function hsv2rgb(h, s, vv) {
  var hv = h - floor(h); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = vv * (1 - s);
  var qv = vv * (1 - fv * s);
  var tv = vv * (1 - (1 - fv) * s);
  if      (iv == 0) { rr = vv; gg = tv; bb = pv; }
  else if (iv == 1) { rr = qv; gg = vv; bb = pv; }
  else if (iv == 2) { rr = pv; gg = vv; bb = tv; }
  else if (iv == 3) { rr = pv; gg = qv; bb = vv; }
  else if (iv == 4) { rr = tv; gg = pv; bb = vv; }
  else              { rr = vv; gg = pv; bb = qv; }
}

// ── Per-frame resolved palette ───────────────────────────────────────────────
var tWash = 0.0;
var h1 = 0.5, h2 = 0.66, sat = 0.7;

export function beforeRender(delta) {
  var rate = pow(2.0, (localSpeed - 0.5) * 4.0);
  tWash = time(0.12 / rate);

  // Resolve the genre index (0..6) from the normalised slider (0..1 * 6) and
  // SNAP to the nearest family. A small in-pattern table maps it to a hue pair
  // + saturation ceiling.
  var gIdx = floor(clamp01(genre) * N_GENRE);
  if (gIdx > 6) gIdx = 6;
  var gh1 = GEN_H1_0; var gh2 = GEN_H2_0; var gs = GEN_S_0;
  if      (gIdx == 1) { gh1 = GEN_H1_1; gh2 = GEN_H2_1; gs = GEN_S_1; }
  else if (gIdx == 2) { gh1 = GEN_H1_2; gh2 = GEN_H2_2; gs = GEN_S_2; }
  else if (gIdx == 3) { gh1 = GEN_H1_3; gh2 = GEN_H2_3; gs = GEN_S_3; }
  else if (gIdx == 4) { gh1 = GEN_H1_4; gh2 = GEN_H2_4; gs = GEN_S_4; }
  else if (gIdx == 5) { gh1 = GEN_H1_5; gh2 = GEN_H2_5; gs = GEN_S_5; }
  else if (gIdx == 6) { gh1 = GEN_H1_6; gh2 = GEN_H2_6; gs = GEN_S_6; }

  // Commit toward the genre palette by confidence × party gate. Low conf / no
  // party => hold the calm neutral teal<->indigo. We blend HUES and SATURATION
  // from neutral toward the genre family, so the look eases into a genre as the
  // classifier grows confident (no jarring snap).
  var commit = clamp01(genreConf) * clamp01(party);
  h1 = NEUTRAL_H1 + (gh1 - NEUTRAL_H1) * commit;
  h2 = NEUTRAL_H2 + (gh2 - NEUTRAL_H2) * commit;
  // saturation: neutral is gentle (0.45), genre commits toward its ceiling
  sat = 0.45 + (gs - 0.45) * commit;
}

export function render3D(index, x, y, z) {
  // Traveling two-colour wash across X with a radial breath — both palette hues
  // read on every rig, and the wash animates so silence is alive (never dark).
  var dx = clamp01(x) - 0.5;
  var dy = clamp01(y) - 0.5;
  var rad = sqrt(dx * dx + dy * dy);

  var grad = clamp01(0.5 + 0.5 * wave(tWash + clamp01(x) * 1.1));   // 0..1 blend pos
  var h = h1 + (h2 - h1) * grad;

  // brightness: an always-on floor (P0 visibility) + a level/party-scaled body
  // that breathes; party lifts the rig (a party look is brighter than calm).
  var breath = 0.6 + 0.4 * wave(tWash * 0.7 + rad * 1.4);
  // Lifted gains so a party look burns bright (peak channel toward 255) while the
  // calm/no-party floor stays gently lit (BASE_FLOOR) — never fully dark (P0).
  var body = (BASE_FLOOR + level * 0.95 * breath) * (0.55 + 0.55 * clamp01(party));
  var bri = clamp01(body);

  hsv2rgb(h, sat, bri);
  rgb(clamp01(rr), clamp01(gg), clamp01(bb));
}
