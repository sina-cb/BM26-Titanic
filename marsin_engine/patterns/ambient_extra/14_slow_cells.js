// DRAFT — pending operator review
/*
  14_slow_cells.js — SLOW CELLS

  CONCEPT
    A low-resolution one-dimensional cellular automaton advances in discrete,
    held generations. Each new graphic state settles before the next arrives,
    and a smooth interpolation between generations keeps the change elegant.
    This is intentionally unlike reaction diffusion: there is no continuous
    chemical field, only crisp binary cells, their borders, and held states.

  INSTRUMENT STAGING
    FIX_BAR_18     — the primary hull-length cell band.
    FIX_RAW_LED    — enlarged alive/dead borders tracing the Silhouette.
    FIX_VINTAGE_6  — six-head binary glyphs in palette RGB, never native white.
    FIX_PAR        — broad live-cell accents across the Organs.
    FIX_TE_SIGN    — identical paired 74-cell windows using pixelLocalIndex.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed      — master generation cadence and restrained spatial drift.
    ruleMix         — selects between branching and clustering neighbor rules.
    cellSize        — cell scale, from fine graph paper to broad blocks.
    generationHold  — duration of the visibly settled part of each generation.
    edgeFade        — softness and reach of enlarged cell boundaries.
    level           — prominence of living cells and their instrument accents.
    safetyFloor     — whole-rig minimum visibility between living cells.

  AUDIO_MODULATION_V1:
    sliderRuleMix <- micMid range 0.25..0.62 curve linear # mids change the cellular rule family
    sliderLevel   <- micLow range 0.35..0.68 curve linear # lows lift living cells without flashing
  Static (unmapped) params: localSpeed, cellSize, generationHold, edgeFade,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB is always an interpolation on the selected cp1-to-cp2 line. This look
    deliberately emits no native white and no UV, so W=A=U=0 exactly. Silence
    retains a complete, attractive ship with a dependable visibility floor.
*/

export var localSpeed = 0.30;
export var ruleMix = 0.44;
export var cellSize = 0.48;
export var generationHold = 0.62;
export var edgeFade = 0.42;
export var level = 0.52;
export var safetyFloor = 0.30;

export var cp1H = 0.56, cp1S = 0.80, cp1V = 0.92;
export var cp2H = 0.82, cp2S = 0.68, cp2V = 0.86;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRuleMix(v) { ruleMix = v; }
export function sliderCellSize(v) { cellSize = v; }
export function sliderGenerationHold(v) { generationHold = v; }
export function sliderEdgeFade(v) { edgeFade = v; }
export function sliderLevel(v) { level = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var CELL_COUNT = 64;
var CLOCK_WRAP = 10000.0;
var PHI = 1.61803399;
var SQRT2 = 1.41421356;

// One array holds the settled generation and one holds the next. Together the
// two 64-cell arrays keep fixed state at 128 cells while leaving comfortable
// headroom in beforeRender.
// state. Both arrays are allocated once, never in the render loop.
var cells = array(64);
var scratch = array(64);

var initialized = 0.0;
var generation = 0.0;
var generationClock = 0.0;
var driftClock = 0.0;
var generationBlend = 1.0;
var updatePending = 0.0;
var updateCursor = 0.0;

var liveRuleMix = 0.44;
var liveCellSize = 0.48;
var liveVisibleCells = 32.0;
var liveGenerationHold = 0.62;
var liveEdgeFade = 0.42;
var liveLevel = 0.52;
var liveSafetyFloor = 0.30;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  var q = clamp01(v);
  return q * q * (3.0 - 2.0 * q);
}

function currentCell(cellIndex) {
  var wrapped = cellIndex;
  if (wrapped < 0.0) wrapped += CELL_COUNT;
  if (wrapped >= CELL_COUNT) wrapped -= CELL_COUNT;
  return cells[wrapped];
}

function mixedCell(cellIndex) {
  var wrapped = cellIndex;
  if (wrapped < 0.0) wrapped += CELL_COUNT;
  if (wrapped >= CELL_COUNT) wrapped -= CELL_COUNT;
  if (updatePending == 2.0) {
    return cells[wrapped]
         + (scratch[wrapped] - cells[wrapped]) * generationBlend;
  }
  // During the chunked copy the completed next state remains the visible
  // source, making the maintenance work invisible.
  if (updatePending == 3.0) {
    return scratch[wrapped];
  }
  return cells[wrapped];
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0.0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1.0) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2.0) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3.0) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4.0) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else                 { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0.0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1.0) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2.0) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3.0) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function seedCells() {
  // Arrays begin at zero. Sparse explicit seeds avoid spending an entire
  // beforeRender instruction budget on initialization.
  cells[2] = 1.0;  cells[3] = 1.0;  cells[11] = 1.0;
  cells[19] = 1.0; cells[20] = 1.0; cells[31] = 1.0;
  cells[37] = 1.0; cells[49] = 1.0; cells[50] = 1.0;
  cells[61] = 1.0;
}

function advanceGenerationChunk() {
  // Blend two genuinely different radius-one binary rules per cell. Rule A
  // branches and travels; Rule B grows broad clustered islands. A moving,
  // deterministic chooser makes the ruleMix continuum perceptually useful.
  var stop = min(CELL_COUNT, updateCursor + 8.0);
  for (var k = updateCursor; k < stop; k++) {
    var leftIndex = k - 1.0;
    if (leftIndex < 0.0) leftIndex += CELL_COUNT;
    var rightIndex = k + 1.0;
    if (rightIndex >= CELL_COUNT) rightIndex -= CELL_COUNT;
    var l = cells[leftIndex];
    var c = cells[k];
    var r = cells[rightIndex];

    // Wolfram rule 90 branches and travels; majority grows broad islands.
    var branch = 0.0;
    if (l != r) branch = 1.0;
    var nearCount = l + c + r;
    var cluster = 0.0;
    if (nearCount >= 2.0) cluster = 1.0;

    var chooser = ((k * 37.0 + generation * 23.0) % 127.0) / 126.0;
    var next = branch;
    if (chooser < clamp01(liveRuleMix)) next = cluster;

    // A sparse traveling pilot prevents either totalistic rule from locking
    // into an all-dead or short-period state over a meaningful performance.
    var pilot = (generation * 19.0 + 7.0) % CELL_COUNT;
    if (k == pilot || k == ((pilot + 29.0) % CELL_COUNT)) next = 1.0 - next;
    scratch[k] = next;
  }
  updateCursor = stop;

  if (updateCursor >= CELL_COUNT) {
    updateCursor = 0.0;
    updatePending = 2.0;
    generationBlend = 0.0;
  }
}

function commitGenerationChunk() {
  var stop = min(CELL_COUNT, updateCursor + 8.0);
  for (var k = updateCursor; k < stop; k++) {
    cells[k] = scratch[k];
  }
  updateCursor = stop;
  if (updateCursor >= CELL_COUNT) {
    generation += 1.0;
    if (generation >= 100000.0) generation -= 100000.0;
    generationClock = 0.0;
    updatePending = 0.0;
  }
}

export function beforeRender(delta) {
  if (initialized == 0.0) {
    seedCells();
    initialized = 1.0;
  }

  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Live edits ease into the spatial and light parameters so MIDI changes do
  // not teleport cell boundaries or brightness on the rig.
  var shapeFollow = min(1.0, dt * 3.1);
  var lightFollow = min(1.0, dt * 5.2);
  liveRuleMix += (clamp01(ruleMix) - liveRuleMix) * shapeFollow;
  liveCellSize += (clamp01(cellSize) - liveCellSize) * shapeFollow;
  liveVisibleCells = 58.0 - pow(liveCellSize, 0.58) * 40.0;
  liveGenerationHold += (clamp01(generationHold) - liveGenerationHold)
                      * shapeFollow;
  liveEdgeFade += (clamp01(edgeFade) - liveEdgeFade) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;
  liveSafetyFloor += (clamp01(safetyFloor) - liveSafetyFloor) * lightFollow;

  var localMult = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  if (updatePending == 0.0) generationClock += dt * localMult;
  driftClock += dt * localMult * 0.019 * PHI;
  if (driftClock >= CLOCK_WRAP) driftClock -= CLOCK_WRAP;

  // generationHold changes the settled dwell from 0.35 to 2.35 seconds.
  // Every transition is a calm 0.42 seconds at 1x local trim.
  var holdSeconds = 0.35 + liveGenerationHold * 2.0;
  var transitionSeconds = 0.42;
  var period = holdSeconds;
  if (updatePending == 0.0 && generationClock >= period) {
    generationClock = period;
    updateCursor = 0.0;
    updatePending = 1.0;
  }
  if (updatePending == 1.0) advanceGenerationChunk();
  else if (updatePending == 2.0) {
    generationBlend += dt * localMult / transitionSeconds;
    if (generationBlend >= 1.0) {
      generationBlend = 1.0;
      updateCursor = 0.0;
      updatePending = 3.0;
    }
  }
  else if (updatePending == 3.0) commitGenerationChunk();

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  // CellSize chooses 18..58 visible cells without ever changing the fixed
  // 64-cell state buffer. A tiny spatial drift keeps held states alive while
  // preserving their graphic, low-resolution identity.
  // Preserve the full 18..58 control range while biasing the saved midpoint
  // toward much larger playa-readable cohorts. The square-root-like curve
  // keeps the endpoint promise intact and prevents the default from looking
  // like fine red/blue graph paper on Titanic's sparse physical spacing.
  var visibleCells = floor(liveVisibleCells);
  var lane = nx * 0.72 + nz * 0.28 + driftClock;
  lane = lane - floor(lane);
  var cellCoordinate = lane * visibleCells;
  var laneCell = floor(cellCoordinate);
  var cellFraction = cellCoordinate - laneCell;
  var stateIndex = floor(laneCell * CELL_COUNT / visibleCells);
  var leftLaneCell = laneCell - 1.0;
  if (leftLaneCell < 0.0) leftLaneCell += visibleCells;
  var rightLaneCell = laneCell + 1.0;
  if (rightLaneCell >= visibleCells) rightLaneCell -= visibleCells;
  var leftStateIndex = floor(leftLaneCell * CELL_COUNT / visibleCells);
  var rightStateIndex = floor(rightLaneCell * CELL_COUNT / visibleCells);
  var alive = mixedCell(stateIndex);
  var aliveLeft = mixedCell(leftStateIndex);
  var aliveRight = mixedCell(rightStateIndex);
  var centerAlive = alive;

  var boundaryDistance = min(cellFraction, 1.0 - cellFraction);
  var edgeReach = 0.035 + liveEdgeFade * 0.24;
  // Soften the moving boundary itself, not merely its highlight. This keeps a
  // cell crossing a physical pixel continuous during live edits and drift.
  // Each side reaches the SAME 50/50 average exactly at a boundary. Reaching
  // 100% of the neighbor would swap endpoints as the cell index increments.
  var leftBlend = 0.5 * (1.0 - smoothstep(0.0, edgeReach, cellFraction));
  var rightBlend = 0.5 * smoothstep(1.0 - edgeReach, 1.0, cellFraction);
  alive = alive * (1.0 - leftBlend - rightBlend)
        + aliveLeft * leftBlend + aliveRight * rightBlend;
  // RuleMix remains a truthful live performance control during held states:
  // the branch end reads individual bits, while the cluster end reveals the
  // neighborhood majority that will guide the next discrete generation.
  var neighborhood = (aliveLeft + alive + aliveRight) / 3.0;
  alive += (neighborhood - alive) * liveRuleMix * 0.72;
  var cellBoundary = 1.0 - smoothstep(edgeReach, edgeReach + 0.055,
                                      boundaryDistance);
  // Difference from the unsmoothed cell center is continuous on both sides
  // of an index wrap; using a newly selected neighbor pair here would jump.
  var graphicEdge = abs(alive - centerAlive) * cellBoundary;

  var floorLevel = 0.055 + liveSafetyFloor * 0.285;
  var paletteMix = clamp01(0.12 + alive * 0.72
                          + graphicEdge * 0.12);
  var brightness = floorLevel + 0.055
                 + alive * (0.16 + liveLevel * 0.42)
                 + graphicEdge * (0.08 + liveEdgeFade * 0.24);
  var levelCell = alive;

  if (fixtureType == FIX_BAR_18) {
    // Hull: the principal crisp cellular tape, with y adding a faint second
    // row so broad wall faces retain depth rather than becoming flat stripes.
    var rowShift = floor(ny * 4.0) * 11.0;
    var rowIndex = (stateIndex + rowShift) % CELL_COUNT;
    var rowCenter = mixedCell(rowIndex);
    var rowState = rowCenter * (1.0 - leftBlend - rightBlend)
                 + mixedCell((leftStateIndex + rowShift) % CELL_COUNT)
                   * leftBlend
                 + mixedCell((rightStateIndex + rowShift) % CELL_COUNT)
                   * rightBlend;
    var rowEdge = abs(rowState - alive);
    brightness = floorLevel + 0.055
               + alive * (0.19 + liveLevel * 0.46)
               + rowState * 0.11 + rowEdge * 0.15
               + graphicEdge * (0.11 + liveEdgeFade * 0.27);
    paletteMix = clamp01(0.08 + alive * 0.54 + rowState * 0.24
                       + graphicEdge * 0.10);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette: enlarged borders, still backed by a readable night outline.
    var enlargedEdge = clamp01(graphicEdge * 1.90);
    brightness = floorLevel + 0.14 + alive * (0.08 + liveLevel * 0.15)
               + enlargedEdge * (0.22 + liveEdgeFade * 0.36);
    paletteMix = clamp01(0.18 + alive * 0.36 + enlargedEdge * 0.39);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Each six-head Jewelry fixture reads as a binary glyph. It remains RGB
    // palette light by design; no native-white sparkle is introduced here.
    var head = pixelLocalIndex % 6.0;
    var glyphIndex = floor((pixelLocalIndex - head) / 6.0) * 13.0 + head * 3.0;
    glyphIndex = glyphIndex % CELL_COUNT;
    var glyphAlive = mixedCell(glyphIndex);
    var alternate = mixedCell((glyphIndex + 41.0) % CELL_COUNT);
    levelCell = glyphAlive;
    brightness = floorLevel * 0.82 + 0.06
               + glyphAlive * (0.19 + liveLevel * 0.43)
               + alternate * 0.09;
    paletteMix = clamp01(0.12 + head / 7.0 + glyphAlive * 0.54);
  } else if (fixtureType == FIX_PAR) {
    // Organs are broad, weighty live-cell accents rather than narrow edges.
    var organIndex = floor((nx * 0.53 + nz * 0.47) * 31.0)
                   + (pixelLocalIndex % 4.0) * 17.0;
    organIndex = organIndex % CELL_COUNT;
    var organAlive = mixedCell(organIndex);
    levelCell = organAlive;
    brightness = floorLevel + 0.13
               + organAlive * (0.20 + liveLevel * 0.52);
    paletteMix = clamp01(0.18 + organAlive * 0.69);
  } else if (isSign) {
    // Fold the two physical fixtures into one complete 74-pixel, 10x8 cell
    // window. Both axes participate in the local lattice and the pair matches.
    var signIndex = index % 74.0;
    var signX = (signIndex % 10.0) / 9.0;
    var signY = floor(signIndex / 10.0) / 7.0;
    var signAlive = mixedCell(signIndex);
    var signBelow = mixedCell((signIndex + 10.0) % 74.0);
    var signRight = mixedCell((signIndex + 1.0) % 74.0);
    var signEdge = max(abs(signAlive - signBelow),
                       abs(signAlive - signRight));
    levelCell = signAlive;
    brightness = max(0.30, floorLevel + 0.17
                    + signAlive * (0.16 + liveLevel * 0.44)
                    + signEdge * (0.12 + liveEdgeFade * 0.24));
    paletteMix = clamp01(0.08 + signAlive * 0.58 + signEdge * 0.24
                       + signX * 0.05 + signY * 0.05);
  }

  // Level is a deliberately broad live-cell prominence control: it lifts the
  // complete composition slightly and the binary foreground more strongly.
  // This keeps low-frequency audio smooth while making the control unmistakable.
  brightness += liveLevel * (0.105 + levelCell * 0.075);
  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
