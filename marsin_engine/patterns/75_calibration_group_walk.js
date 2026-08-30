// DRAFT — pending operator review
/*
  75_calibration_group_walk.js — per-group wiring-order + colour diagnostic.

  One fader per pixel group. Raising a group's fader from 0 to 1 lights that
  group's LEDs ONE BY ONE in true wiring order (model/patch order), so a pixel
  appearing out of sequence is a mis-mapped strand or a swapped chain. Each lit
  LED carries a fixed repeating colour cycle — RED, GREEN, BLUE, WHITE — so a
  swapped colour channel is equally unmissable (LED 1 must be red, 2 green,
  3 blue, 4 white, 5 red, …).

  Model binding: the group→index ranges below are BAKED from the titanic /
  titanic_normalized roster (byte-identical rosters, all groups contiguous).
  This is deliberately a titanic-family diagnostic, not a portable one — exact
  ordinals are the whole point, and inView() cannot yield per-group ordinals.
  If the roster ever re-exports with different pixel counts, re-bake the table
  (marsin_engine/models/titanic_normalized.js is the source of truth).

  Static utility: no motion clock, no localSpeed, palette opt-out (fixed
  primaries are the test language). Background keeps unlit pixels faintly
  visible so missing pixels can be spotted against truly dark ones.
*/

export var background = 0.3;
export function sliderBackground(v) { background = v; }

export var teSign = 0;
export function sliderTeSign(v) { teSign = v; }
export var teSign2 = 0;
export function sliderTeSign2(v) { teSign2 = v; }
export var rightFrontWall = 0;
export function sliderRightFrontWall(v) { rightFrontWall = v; }
export var rightSmokeStacks = 0;
export function sliderRightSmokeStacks(v) { rightSmokeStacks = v; }
export var rightFrontRails = 0;
export function sliderRightFrontRails(v) { rightFrontRails = v; }
export var rightAuditorium = 0;
export function sliderRightAuditorium(v) { rightAuditorium = v; }
export var leftAuditorium = 0;
export function sliderLeftAuditorium(v) { leftAuditorium = v; }
export var leftBackWall = 0;
export function sliderLeftBackWall(v) { leftBackWall = v; }
export var rightBackWall = 0;
export function sliderRightBackWall(v) { rightBackWall = v; }
export var leftFrontWall = 0;
export function sliderLeftFrontWall(v) { leftFrontWall = v; }
export var leftSmokeStack = 0;
export function sliderLeftSmokeStack(v) { leftSmokeStack = v; }
export var leftFrontRails = 0;
export function sliderLeftFrontRails(v) { leftFrontRails = v; }
export var rightBackRails = 0;
export function sliderRightBackRails(v) { rightBackRails = v; }
export var leftBackRails = 0;
export function sliderLeftBackRails(v) { leftBackRails = v; }
export var leftSmallStack = 0;
export function sliderLeftSmallStack(v) { leftSmallStack = v; }
export var rightSmallStack = 0;
export function sliderRightSmallStack(v) { rightSmallStack = v; }
export var stringsFrontLeft = 0;
export function sliderStringsFrontLeft(v) { stringsFrontLeft = v; }
export var stringsBackLeft = 0;
export function sliderStringsBackLeft(v) { stringsBackLeft = v; }
export var stringsBackRight = 0;
export function sliderStringsBackRight(v) { stringsBackRight = v; }
export var stringsFrontRight = 0;
export function sliderStringsFrontRight(v) { stringsFrontRight = v; }
export var stringsRBackLeft = 0;
export function sliderStringsRBackLeft(v) { stringsRBackLeft = v; }
export var stringsRBackRight = 0;
export function sliderStringsRBackRight(v) { stringsRBackRight = v; }
export var stringsRFrontRight = 0;
export function sliderStringsRFrontRight(v) { stringsRFrontRight = v; }
export var stringsRFrontLeft = 0;
export function sliderStringsRFrontLeft(v) { stringsRFrontLeft = v; }

// Paint the walked prefix of one group. ord counts from the group's FIRST
// wired pixel; the LED lights once the fader passes its ordinal fraction.
// Colour cycle by ordinal: 0=R 1=G 2=B 3=W, repeating.
function paintWalk(ord, count, fader) {
  if (fader <= 0) return 0;
  if (ord / count >= fader) return 0;
  var c = ord - floor(ord / 4) * 4;
  if (c == 0) rgb(1, 0, 0);
  else if (c == 1) rgb(0, 1, 0);
  else if (c == 2) rgb(0, 0, 1);
  else rgb(1, 1, 1);
  return 1;
}

export function render3D(index, x, y, z) {
  var painted = 0;
  if (index < 74)       painted = paintWalk(index,       74, teSign);
  else if (index < 148) painted = paintWalk(index - 74,  74, teSign2);
  else if (index < 238) painted = paintWalk(index - 148, 90, rightFrontWall);
  else if (index < 246) painted = paintWalk(index - 238,  8, rightSmokeStacks);
  else if (index < 270) painted = paintWalk(index - 246, 24, rightFrontRails);
  else if (index < 278) painted = paintWalk(index - 270,  8, rightAuditorium);
  else if (index < 286) painted = paintWalk(index - 278,  8, leftAuditorium);
  else if (index < 376) painted = paintWalk(index - 286, 90, leftBackWall);
  else if (index < 466) painted = paintWalk(index - 376, 90, rightBackWall);
  else if (index < 556) painted = paintWalk(index - 466, 90, leftFrontWall);
  else if (index < 564) painted = paintWalk(index - 556,  8, leftSmokeStack);
  else if (index < 588) painted = paintWalk(index - 564, 24, leftFrontRails);
  else if (index < 612) painted = paintWalk(index - 588, 24, rightBackRails);
  else if (index < 636) painted = paintWalk(index - 612, 24, leftBackRails);
  else if (index < 640) painted = paintWalk(index - 636,  4, leftSmallStack);
  else if (index < 644) painted = paintWalk(index - 640,  4, rightSmallStack);
  else if (index < 684) painted = paintWalk(index - 644, 40, stringsFrontLeft);
  else if (index < 724) painted = paintWalk(index - 684, 40, stringsBackLeft);
  else if (index < 764) painted = paintWalk(index - 724, 40, stringsBackRight);
  else if (index < 804) painted = paintWalk(index - 764, 40, stringsFrontRight);
  else if (index < 844) painted = paintWalk(index - 804, 40, stringsRBackLeft);
  else if (index < 884) painted = paintWalk(index - 844, 40, stringsRBackRight);
  else if (index < 924) painted = paintWalk(index - 884, 40, stringsRFrontRight);
  else                  painted = paintWalk(index - 924, 40, stringsRFrontLeft);

  if (painted == 0) {
    var floorLevel = 0.015 + background * 0.12;
    rgb(floorLevel, floorLevel * 0.6, floorLevel * 0.2);
  }
}
