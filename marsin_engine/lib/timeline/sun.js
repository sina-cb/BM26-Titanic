/*
 * sun.js — pure, dependency-free solar-position math for the Timeline
 * Companion (NOAA / SunCalc algorithm — public-domain). NO network, NO
 * data files: offline readiness is a deployment requirement (codex P0).
 *
 * `computeSunEvents({ lat, lon, date })` returns the day's solar instants as
 * JS Date objects (UTC). A missing event (polar day/night) is returned as
 * `null` — absence of an event is legitimate data, not an error, so we do NOT
 * throw for it. Bad INPUT (out-of-range lat/lon, non-Date date) DOES throw.
 *
 * The math is the standard sunrise-equation pipeline used by SunCalc: convert
 * the date to Julian days, compute the sun's ecliptic + equatorial position,
 * the hour angle for a target altitude, and map the resulting transit/hour
 * angle back to UTC instants.
 */

const RAD = Math.PI / 180;
const DAY_MS = 1000 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;
// Earth's obliquity of the ecliptic (radians).
const E = RAD * 23.4397;

// Altitude thresholds (degrees) for each event family.
const H_SUNRISE = -0.833;
const H_CIVIL = -6;
const H_NAUTICAL = -12;
const H_GOLDEN = 6;

// ── Julian-day plumbing ──────────────────────────────────────────────────────

function toJulian(date) {
  return date.valueOf() / DAY_MS - 0.5 + J1970;
}

function fromJulian(j) {
  return new Date((j + 0.5 - J1970) * DAY_MS);
}

function toDays(date) {
  return toJulian(date) - J2000;
}

// ── Solar position ───────────────────────────────────────────────────────────

function solarMeanAnomaly(d) {
  return RAD * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(m) {
  // Equation of center + perihelion of the Earth.
  const c = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  const p = RAD * 102.9372;
  return m + c + p + Math.PI;
}

function declination(l) {
  return Math.asin(Math.sin(E) * Math.sin(l));
}

// ── Sunrise-equation helpers ─────────────────────────────────────────────────

function julianCycle(d, lw) {
  return Math.round(d - 0.0009 - lw / (2 * Math.PI));
}

function approxTransit(ht, lw, n) {
  return 0.0009 + (ht + lw) / (2 * Math.PI) + n;
}

function solarTransitJ(ds, m, l) {
  return J2000 + ds + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);
}

function hourAngle(h, phi, dec) {
  // Returns NaN when the sun never reaches altitude `h` that day (polar).
  return Math.acos(
    (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)),
  );
}

/**
 * Julian day of the SETTING crossing of altitude `h` (degrees), for the day
 * containing `d` at longitude-west `lw` / latitude `phi`. The matching RISING
 * crossing is mirrored about solar transit. Returns NaN when the sun does not
 * reach `h` that day.
 */
function getSetJ(h, lw, phi, dec, n, m, l) {
  const w = hourAngle(h, phi, dec);
  if (Number.isNaN(w)) return NaN;
  const a = approxTransit(w, lw, n);
  return solarTransitJ(a, m, l);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * The 'YYYY-MM-DD' calendar day of `date` in IANA timezone `tz`.
 */
function localDayKey(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(date); // en-CA → "YYYY-MM-DD"
}

/**
 * Anchor `date` to NOON of its local calendar day in `tz`, returned as a UTC
 * Date. Anchoring at local noon makes the solar-day index (julianCycle/toDays)
 * identical for ANY instant on a given local calendar day, so events computed
 * just after local midnight in a western timezone land on the right day rather
 * than the previous UTC day. We resolve the tz offset for that local day and
 * subtract it from the naive (treated-as-UTC) local-noon instant.
 */
function localNoonAnchor(date, tz) {
  const dayKey = localDayKey(date, tz);
  const [y, mo, d] = dayKey.split('-').map(Number);
  const naiveUtc = Date.UTC(y, mo - 1, d, 12, 0, 0);
  // Offset (minutes, east-positive) of `tz` at that local-noon instant.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(naiveUtc));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  const offsetMin = Math.round((asUtc - naiveUtc) / (1000 * 60));
  return new Date(naiveUtc - offsetMin * 60 * 1000);
}

/**
 * Compute the day's solar events as UTC Date instants (or null when the event
 * does not occur that day). `date` is any instant on the target calendar day.
 *
 * When `tz` (IANA) is given, the calendar day is the LOCAL day in `tz`: the
 * computation is anchored to noon of that local day, so ANY instant on a given
 * local calendar day yields identical events (fixes the western-longitude
 * after-local-midnight off-by-one-day bug). When `tz` is OMITTED we fall back
 * to the legacy behavior: the solar day is derived from the raw UTC instant,
 * which can disagree with the local calendar day for instants near midnight in
 * timezones far from UTC. Always pass `tz` for plan-anchored use.
 *
 * @param {{ lat:number, lon:number, date:Date, tz?:string }} args
 * @returns {{ sunrise, sunset, solarNoon, civilDawn, civilDusk,
 *             nauticalDawn, nauticalDusk, goldenHourEnd, goldenHourStart }}
 */
export function computeSunEvents({ lat, lon, date, tz }) {
  if (typeof lat !== 'number' || Number.isNaN(lat) || lat < -90 || lat > 90) {
    throw new Error(`computeSunEvents: lat must be a number in [-90, 90], got ${lat}`);
  }
  if (typeof lon !== 'number' || Number.isNaN(lon) || lon < -180 || lon > 180) {
    throw new Error(`computeSunEvents: lon must be a number in [-180, 180], got ${lon}`);
  }
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw new Error('computeSunEvents: date must be a valid Date');
  }
  if (tz !== undefined && (typeof tz !== 'string' || !tz.trim())) {
    throw new Error('computeSunEvents: tz, when given, must be a non-empty IANA timezone string');
  }

  // Anchor to noon of the local calendar day so the solar-day index is the same
  // for any instant on that local day (back-compat: no tz → raw instant).
  const anchored = tz ? localNoonAnchor(date, tz) : date;

  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(anchored);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const m = solarMeanAnomaly(ds);
  const l = eclipticLongitude(m);
  const dec = declination(l);

  // Solar transit (noon) — always defined.
  const jNoon = solarTransitJ(ds, m, l);
  const solarNoon = fromJulian(jNoon);

  // For each target altitude: the SET crossing comes from getSetJ; the RISE
  // crossing is its mirror about solar transit (jRise = jNoon - (jSet - jNoon)).
  const crossings = (h) => {
    const jSet = getSetJ(RAD * h, lw, phi, dec, n, m, l);
    if (Number.isNaN(jSet)) return { rise: null, set: null };
    const jRise = jNoon - (jSet - jNoon);
    return { rise: fromJulian(jRise), set: fromJulian(jSet) };
  };

  const sun = crossings(H_SUNRISE);
  const civil = crossings(H_CIVIL);
  const nautical = crossings(H_NAUTICAL);
  const golden = crossings(H_GOLDEN);

  return {
    sunrise: sun.rise,
    sunset: sun.set,
    solarNoon,
    civilDawn: civil.rise,
    civilDusk: civil.set,
    nauticalDawn: nautical.rise,
    nauticalDusk: nautical.set,
    goldenHourEnd: golden.rise,
    goldenHourStart: golden.set,
  };
}

/**
 * Format a Date as "HH:MM" in the given IANA timezone (24h). Throws on a bad
 * Date so a programming error surfaces loudly.
 *
 * @param {Date} date
 * @param {string} tz — IANA timezone (e.g. 'America/Los_Angeles')
 * @returns {string}
 */
export function formatLocal(date, tz) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw new Error('formatLocal: date must be a valid Date');
  }
  if (typeof tz !== 'string' || !tz.trim()) {
    throw new Error('formatLocal: tz must be a non-empty IANA timezone string');
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // Intl can emit "24:05" at midnight on some platforms; normalize to "00".
  const parts = fmt.formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour').value;
  const minute = parts.find((p) => p.type === 'minute').value;
  const hh = hour === '24' ? '00' : hour;
  return `${hh}:${minute}`;
}
