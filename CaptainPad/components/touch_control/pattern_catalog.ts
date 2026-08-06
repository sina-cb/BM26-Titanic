/**
 * pattern_catalog.ts - operator-facing descriptions of the engine's patterns,
 * for the TOUCH CONTROL tab's pattern list.  TOUCH CONTROL ONLY: nothing here
 * is imported by any other tab, and nothing here changes engine behaviour.
 *
 * WHY A STATIC CATALOG.  The engine's `GET /list-patterns` returns NAMES ONLY
 * - there is no description field anywhere in the API, and the prose that does
 * exist lives in each pattern file's header comment (which the browser cannot
 * read).  Fetching + parsing 69 pattern sources to populate a list would cost
 * 69 round trips on a playa laptop, so the blurbs below were written from those
 * headers and are shipped with the app.
 *
 * WHAT `colors` MEANS.  Touch Control paints a pattern through the palette
 * contract, so a pattern only takes the colours it actually declares:
 *   'five'  - declares sliderHue3/4/5 on top of the palette: all 5 dots land.
 *   'two'   - declares colorPalette1/2: colour dots 1 and 2 land, 3-5 do not.
 *   'fixed' - declares neither: the pattern ignores your colours entirely
 *             (the WHITE ONLY family, UV, calibration, rainbow).
 * These were read off the `export function colorPalette1/2` and
 * `export function sliderHue3/4/5` declarations in the pattern sources, with
 * comments stripped - 60_white_wash MENTIONS colorPalette1 in its header while
 * deliberately not exporting it, so a plain text search gets it wrong.
 *
 * THIS CATALOG IS A SNAPSHOT, NOT THE SOURCE OF TRUTH.  The engine decides
 * what patterns exist.  A pattern the engine reports but this file does not
 * know is still listed - shown honestly as having no description on file,
 * never given an invented one.
 */

export type PatternFamily =
  | 'signature'
  | 'beat'
  | 'geometry'
  | 'ambient'
  | 'ocean'
  | 'white'
  | 'utility';

/** How many of Touch Control's five colour dots a pattern can actually use. */
export type PatternColors = 'five' | 'two' | 'fixed';

export interface PatternInfo {
  /** Engine id - exactly what `/list-patterns` returns and `/set-pattern` takes. */
  name: string;
  /** Human title for the list row. */
  title: string;
  /** One line: what the operator will see on the ship. */
  blurb: string;
  family: PatternFamily;
  colors: PatternColors;
}

export const FAMILY_LABELS: Record<PatternFamily, string> = {
  signature: 'SIGNATURE',
  beat: 'BEAT + EDM',
  geometry: 'GEOMETRY',
  ambient: 'AMBIENT',
  ocean: 'OCEAN',
  white: 'WHITE ONLY',
  utility: 'UTILITY',
};

/** Render order of the family groups in the list. */
export const FAMILY_ORDER: PatternFamily[] = [
  'signature',
  'beat',
  'geometry',
  'ambient',
  'ocean',
  'white',
  'utility',
];

export const COLOR_LABELS: Record<PatternColors, string> = {
  five: 'ALL 5 COLOURS',
  two: 'COLOURS 1-2',
  fixed: 'IGNORES COLOURS',
};

export const PATTERN_CATALOG: PatternInfo[] = [
  // ---- signature -------------------------------------------------------
  {
    name: '66_five_colour_prism',
    title: 'Five Colour Prism',
    blurb:
      'Splits the ship into five zones, each holding a different one of your colours, and slowly rotates them so every colour visits every part.',
    family: 'signature',
    colors: 'five',
  },
  {
    name: '67_five_colour_stations',
    title: 'Five Colour Stations',
    blurb:
      'Every one of the five ship stations - bow, stern, stacks, decks, sign - carries all five of your colours at once, in blocks that march along it.',
    family: 'signature',
    colors: 'five',
  },
  {
    name: '26_dom_dancers_chevron',
    title: 'Dancers + Chevron',
    blurb:
      'Two soft dancing orbs drift behind an intricate spiral filigree. Built for the Titanic exterior - stays alive at zero audio.',
    family: 'signature',
    colors: 'two',
  },
  {
    name: '58_lighthouse_solo',
    title: 'Lighthouse Solo',
    blurb:
      'One crisp beam rotates around the ship on a near-black night. The longest-range read in the set - always lit, even in silence.',
    family: 'signature',
    colors: 'two',
  },

  // ---- beat + EDM ------------------------------------------------------
  {
    name: '01_cylon_sweep',
    title: 'Cylon Sweep',
    blurb:
      'A single bright scanner eye sweeps side to side across the ship over a dim background glow.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '03_dual_axis_crush',
    title: 'Dual Axis Crush',
    blurb:
      'Beams spawn at the far left and right and collapse inward to centre stage, flashing bright where they meet.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '06_neon_elevator',
    title: 'Neon Elevator',
    blurb:
      'A light car rides the vertical stack - bars, then pars, then vintage - with a white arrival pop at each floor.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '09_cyclone',
    title: 'Confetti Cyclone',
    blurb:
      'A swirling storm of bright confetti specks streams around the ship, glinting as they tumble.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '10_chasers',
    title: 'Life-Cycle Chasers',
    blurb:
      'Comet-like chasers streak around the ship, each a bright head with a fading tail, each living its own life.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '25_heartbeat',
    title: 'Heartbeat',
    blurb:
      'A lub-DUB double pulse lifts the whole ship in a left-to-right gradient, with a low glow resting between beats.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '28_spectrum_bloom',
    title: 'Spectrum Bloom',
    blurb:
      'A literal spectrum analyser painted on the ship: lows grow outward on the bars, mids lift columns, highs sparkle up top.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '29_kick_shockwave',
    title: 'Kick Shockwave',
    blurb:
      'Every kick fires a sharp ring expanding across true black. Negative space - only the ring lights.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '30_bass_comet',
    title: 'Bass Comet',
    blurb:
      'One comet streaks the length of the ship and leaves a real painted trail that fades behind it.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '31_strobe_lattice',
    title: 'Strobe Lattice',
    blurb:
      'An EDM lattice of glowing nodes over true black. Bass raises the brightness, the beat flashes the grid.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '37_chevron_chase',
    title: 'Chevron Chase',
    blurb:
      'Crisp arrowhead bands chase along the ship, stepping forward on the beat with true black between them.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '39_tide_riser',
    title: 'Tide Riser',
    blurb:
      'A glowing waterline climbs the ship as the build energy rises; the kick flings bright foam spray above it.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '48_heartbeat_drive',
    title: 'Heartbeat Drive',
    blurb:
      'Every kick re-arms a lub-DUB and throws a bright shell expanding from the ship centre. Vintage heads blind on the big hits.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '49_cylon_crush',
    title: 'Cylon Crush',
    blurb:
      'The scanner sweep crossed with twin bars collapsing to centre - a sharp core with a decaying trail, meeting in a flash.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '51_confetti_cyclone',
    title: 'Confetti Cyclone HD',
    blurb:
      'Bright confetti sparks orbit a drifting cyclone centre, each a crisp point with a short fading trail over true black.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '53_neon_elevator_hd',
    title: 'Neon Elevator HD',
    blurb:
      'A stack of neon floors scrolls upward forever and jumps a whole floor on the kick.',
    family: 'beat',
    colors: 'two',
  },
  {
    name: '04_beat_folded_helix',
    title: 'Beat-Folded Helix',
    blurb:
      'Spiralling arms twist down a depth tunnel while the beat pops the pars and drives the white channel hard.',
    family: 'beat',
    colors: 'two',
  },

  // ---- geometry --------------------------------------------------------
  {
    name: '02_phase_cathedral',
    title: 'Phase Cathedral',
    blurb:
      'Crossing sine planes build a beat-locked interference field that collapses into crisp bright cores with near-black gaps.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '05_orbital_attractor_field',
    title: 'Orbital Attractor Field',
    blurb:
      'Three orbiting points sweep the ship; every pixel lights from whichever one is nearest, giving crisp cores on black.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '17_rolling_color_dunes',
    title: 'Rolling Colour Dunes',
    blurb:
      'Layered dune contours roll across the bars, surf lines break across the pars, and the vintage heads glow amber.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '18_deep_space_lattice',
    title: 'Deep Space Lattice',
    blurb:
      'Two crossed wave grids and a diagonal weave drift as crisp lattice lines over a near-black void.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '19_swaying_lattice_ballet',
    title: 'Swaying Lattice Ballet',
    blurb:
      'A grid of glowing nodes sways in counter-phase - one row bowing left while the row behind bows right.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '20_parametric_sway_field',
    title: 'Parametric Sway Field',
    blurb:
      'Three glowing attractors wander the ship on a looping path, trailing colour between your two ends.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '23_prismatic_strange_attractors',
    title: 'Strange Attractors',
    blurb:
      'Three moving gravity wells orbit the ship trailing prismatic filaments, with white cores and a UV ghost.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '24_chromatic_murmuration',
    title: 'Chromatic Murmuration',
    blurb:
      'Three flock centres swirl across the ship, woven together by ribbon filaments and a drifting shadow.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '27_swipe',
    title: 'Swipe',
    blurb:
      'One sharp high-contrast band sweeps every fixture along whichever axis fits its type. Simple, loud, readable.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '34_moire_interference',
    title: 'Moire Interference',
    blurb:
      'Two slightly detuned wave grids beat against each other into sharp bands that crawl and breathe.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '36_orbital_pulse',
    title: 'Orbital Pulse',
    blurb:
      'Four gravity wells orbit and weave without ever re-phasing. Bass tightens their cores and lifts the field.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '38_prism_helix',
    title: 'Prism Helix',
    blurb:
      'A hypnotic rotating prism tunnel - bright helical arms wind around a depth axis with true-black gaps.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '40_lissajous_weave',
    title: 'Lissajous Weave',
    blurb:
      'A single curve is woven across the ship and painted where it passes; both colours travel along its length.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '42_phyllotaxis_spiral',
    title: 'Phyllotaxis Spiral',
    blurb:
      'A sunflower seed spiral blooms across the ship on the golden angle - a field of crisp points, not a wash.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '47_quasicrystal_dunes',
    title: 'Quasicrystal Dunes',
    blurb:
      'A true five-fold quasicrystal dune field that rolls and reshapes forever and never exactly repeats.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '50_phase_cathedral_hd',
    title: 'Phase Cathedral HD',
    blurb:
      'Four crossing sine planes light bright cathedral-window nodes over true-dark naves. Never repeats.',
    family: 'geometry',
    colors: 'two',
  },
  {
    name: '54_murmuration_storm',
    title: 'Murmuration Storm',
    blurb:
      'A flock of starlings drifts and swirls as a colour storm; the colour follows the flock direction.',
    family: 'geometry',
    colors: 'two',
  },

  // ---- ambient ---------------------------------------------------------
  {
    name: '00_golden_hour_wash',
    title: 'Golden Hour Wash',
    blurb:
      'An extremely warm shifting sunset wash drifts across the ship. The vintage heads punch white on the kick.',
    family: 'ambient',
    colors: 'two',
  },
  {
    name: '07_shimmer',
    title: 'Shimmering Glow',
    blurb:
      'A warm slow-breathing wash with crisp travelling glints on top, like candlelight on water.',
    family: 'ambient',
    colors: 'two',
  },
  {
    name: '12_breathing',
    title: 'Breathing',
    blurb:
      'The whole ship inhales and exhales as one body, with a ripple so the breath travels rather than pulsing in lockstep.',
    family: 'ambient',
    colors: 'two',
  },
  {
    name: '13_sparkle',
    title: 'Section Sparkle',
    blurb:
      'A dim wash from colour 1 on the left to colour 2 on the right, with crisp sparkle bursts flashing between them.',
    family: 'ambient',
    colors: 'two',
  },
  {
    name: '15_silk_prism_ribbons',
    title: 'Silk Prism Ribbons',
    blurb:
      'Smooth satin ribbons of light slide through the ship with a slow cross-shadow and a travelling colour blend.',
    family: 'ambient',
    colors: 'two',
  },
  {
    name: '33_aurora_breath',
    title: 'Aurora Breath',
    blurb:
      'Soft vertical aurora curtains drift and undulate, colour 1 near the base rising into colour 2 at the crown.',
    family: 'ambient',
    colors: 'two',
  },
  {
    name: '35_sparkle_rain',
    title: 'Sparkle Rain',
    blurb:
      'Dense, fine, crisp glints fall down the ship on a near-black field. No blur - the glints stay single points.',
    family: 'ambient',
    colors: 'two',
  },
  {
    name: '41_reaction_diffusion',
    title: 'Reaction Diffusion',
    blurb:
      'A living chemical skin: two reagents react and spread across the ship, growing organic blotches that never settle.',
    family: 'ambient',
    colors: 'two',
  },
  {
    name: '43_golden_hour_pulse',
    title: 'Golden Hour Pulse',
    blurb:
      'The golden-hour sunset wash sharpened into crisp warm cores and darker troughs, and wired to the music.',
    family: 'ambient',
    colors: 'two',
  },
  {
    name: '52_silk_ribbons',
    title: 'Silk Ribbons HD',
    blurb:
      'Satin ribbons meander across the ship on a path that never loops, both colours flowing through the silk.',
    family: 'ambient',
    colors: 'two',
  },
  {
    name: '57_ink_diffuse',
    title: 'Ink Diffuse',
    blurb:
      'Coloured ink dropped into still water blooms at a wandering point, then diffuses outward and fades. Highs feed fresh blooms.',
    family: 'ambient',
    colors: 'two',
  },

  // ---- ocean -----------------------------------------------------------
  {
    name: '08_ocean_liner',
    title: 'Ocean Liner Nocturne',
    blurb:
      'A quiet dark water wash drifts along the hull while bright portholes glow in the night.',
    family: 'ocean',
    colors: 'two',
  },
  {
    name: '11_bioluminescence',
    title: 'Bioluminescence',
    blurb:
      'A slow ambient swell with sharp bright crests and a gentle additive UV glow - the signature blacklight feel.',
    family: 'ocean',
    colors: 'two',
  },
  {
    name: '14_lunar_current',
    title: 'Lunar Current',
    blurb:
      'Wide smooth moonlit currents drift through the ship with caustic shimmer and a white crown on the upper heads.',
    family: 'ocean',
    colors: 'two',
  },
  {
    name: '16_ghost_tide_uv',
    title: 'Ghost Tide UV',
    blurb:
      'A ghostly foam crest sweeps over a deep mist with a UV undertow swelling beneath. The foam drives white hard.',
    family: 'ocean',
    colors: 'two',
  },
  {
    name: '21_pelagic_manta_rays',
    title: 'Pelagic Manta Rays',
    blurb:
      'Manta-ray silhouettes glide across the ship in a sea-to-reef palette, with white foam crests and a UV undertow.',
    family: 'ocean',
    colors: 'two',
  },
  {
    name: '22_abyssal_sway_garden',
    title: 'Abyssal Sway Garden',
    blurb:
      'A garden of vertical fronds sways in a slow deep current, phosphorescent tips flickering at the top.',
    family: 'ocean',
    colors: 'two',
  },
  {
    name: '32_caustic_shimmer',
    title: 'Caustic Shimmer',
    blurb:
      'Flowing bright veins of water caustics, like sunlight on a pool floor, with crisp white shimmer glints on top.',
    family: 'ocean',
    colors: 'two',
  },
  {
    name: '44_biolume_swell',
    title: 'Biolume Swell',
    blurb:
      'A slow underwater swell with sharp crests that pop only where the swell peaks, over a gentle UV glow.',
    family: 'ocean',
    colors: 'two',
  },
  {
    name: '45_manta_drift',
    title: 'Manta Drift',
    blurb:
      'A small school of manta rays glides over lit water, wings beating, wing tips carrying bright phosphorescent foam.',
    family: 'ocean',
    colors: 'two',
  },
  {
    name: '46_abyssal_fronds',
    title: 'Abyssal Fronds',
    blurb:
      'Kelp fronds stand and sway laterally in a slow current, each glowing tip in your second colour over dark water.',
    family: 'ocean',
    colors: 'two',
  },

  // ---- white only ------------------------------------------------------
  {
    name: '60_white_wash',
    title: 'White Wash',
    blurb:
      'A pure white ambient wash with no hue at all. Its evenness control flattens it into a flat work light for strike.',
    family: 'white',
    colors: 'fixed',
  },
  {
    name: '61_white_breathe',
    title: 'White Breathe',
    blurb:
      'A slow deep whole-ship white breath that rolls across the fixtures instead of pulsing in perfect lockstep.',
    family: 'white',
    colors: 'fixed',
  },
  {
    name: '62_white_shimmer',
    title: 'White Shimmer',
    blurb:
      'Champagne frost shimmer: a dim white bed with sharp white sparkles firing on their own clocks, so it glitters.',
    family: 'white',
    colors: 'fixed',
  },
  {
    name: '63_white_chase',
    title: 'White Chase',
    blurb:
      'Hard white bars sweep the ship with a decaying tail - a searchlight read in pure white, with blinder bite on the kick.',
    family: 'white',
    colors: 'fixed',
  },
  {
    name: '64_temple_warm_white',
    title: 'Temple Warm White',
    blurb:
      'The reverent one. Dim, slow, candle-warm white drifting like light through dust. No strobe, no snap, shallow audio response.',
    family: 'white',
    colors: 'fixed',
  },

  // ---- utility ---------------------------------------------------------
  {
    name: '65_uv_only',
    title: 'UV Only',
    blurb:
      'Experimental spike. Drives only the UV/violet lane so the operator can judge in front of the real rig whether it is worth using.',
    family: 'utility',
    colors: 'fixed',
  },
  {
    name: 'calib_swipe_left_right',
    title: 'Calibration: Left-Right',
    blurb:
      'A sharp band sweeps left to right. The lit band must read as one clean line in both the 3D view and the 2D map.',
    family: 'utility',
    colors: 'fixed',
  },
  {
    name: 'calib_swipe_up_down',
    title: 'Calibration: Up-Down',
    blurb:
      'The same check on the other axis - a band sweeping bow to stern. Pixels that break away belong to a mis-placed fixture.',
    family: 'utility',
    colors: 'fixed',
  },
  {
    name: 'rainbow',
    title: 'Rainbow',
    blurb:
      'The stock Pixelblaze rainbow - a hue ramp scrolling along the pixel index. Ignores your colours entirely.',
    family: 'utility',
    colors: 'fixed',
  },
  {
    name: 'test_const',
    title: 'Test: Constant Colour',
    blurb: 'A single flat colour across every pixel, taken from colour 1. Useful for checking output and levels.',
    family: 'utility',
    colors: 'two',
  },
  {
    name: 'test_dualband',
    title: 'Test: Dual Band',
    blurb: 'Two flat bands, one per palette colour. Useful for confirming both colours reach the rig.',
    family: 'utility',
    colors: 'two',
  },
];

const BY_NAME: Map<string, PatternInfo> = new Map(PATTERN_CATALOG.map((p) => [p.name, p]));

/** Catalog entry for an engine pattern id, or null when it is not catalogued. */
export function patternInfo(name: string): PatternInfo | null {
  return BY_NAME.get(name) ?? null;
}

/** A list row: a live engine pattern, plus whatever we know about it. */
export interface PatternRow {
  name: string;
  title: string;
  blurb: string;
  family: PatternFamily;
  colors: PatternColors | null;
  /** False when the engine reports a pattern this catalog has never heard of. */
  known: boolean;
}

/**
 * Turn an engine id into a readable title when the catalog has no entry.
 * `31_strobe_lattice` -> `31 Strobe Lattice`.  Deliberately NOT a description:
 * an uncatalogued pattern is shown with an empty blurb so the UI can say so,
 * rather than dressing a filename up as one.
 */
export function titleFromName(name: string): string {
  return name
    .split(/[_-]+/)
    .filter((w) => w.length > 0)
    .map((w) => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Merge the engine's live pattern list with this catalog.  The ENGINE decides
 * what exists: a name it reports is always listed, even with no entry here, and
 * a catalog entry the engine does not report is dropped (that pattern file is
 * not loaded).  Uncatalogued rows carry `known: false` and an empty blurb.
 */
export function buildPatternRows(engineNames: string[]): PatternRow[] {
  return engineNames.map((name) => {
    const info = BY_NAME.get(name);
    if (info) {
      return {
        name,
        title: info.title,
        blurb: info.blurb,
        family: info.family,
        colors: info.colors,
        known: true,
      };
    }
    return {
      name,
      title: titleFromName(name),
      blurb: '',
      family: 'utility' as PatternFamily,
      colors: null,
      known: false,
    };
  });
}

export interface PatternGroup {
  family: PatternFamily;
  label: string;
  rows: PatternRow[];
}

/** Group rows by family in FAMILY_ORDER, dropping families with no rows. */
export function groupPatternRows(rows: PatternRow[]): PatternGroup[] {
  const groups: PatternGroup[] = [];
  for (const family of FAMILY_ORDER) {
    const inFamily = rows.filter((r) => r.family === family);
    if (inFamily.length > 0) {
      groups.push({ family, label: FAMILY_LABELS[family], rows: inFamily });
    }
  }
  return groups;
}

/**
 * Case-insensitive search across id, title and blurb.  An empty or whitespace
 * query returns every row unchanged.
 */
export function filterPatternRows(rows: PatternRow[], query: string): PatternRow[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return rows;
  return rows.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q) ||
      r.blurb.toLowerCase().includes(q),
  );
}

/**
 * The sentence shown under a selected pattern explaining what Touch Control
 * can actually paint on it.  Returns null when we do not know the pattern, so
 * the caller can say exactly that instead of guessing.
 */
export function colorSupportNote(colors: PatternColors | null): string | null {
  if (colors === null) return null;
  if (colors === 'five') return 'All five colour dots reach this pattern.';
  if (colors === 'two') return 'This pattern takes colour dots 1 and 2. Dots 3-5 will not reach it.';
  return 'This pattern has no colour inputs - your colour dots will not change it.';
}
