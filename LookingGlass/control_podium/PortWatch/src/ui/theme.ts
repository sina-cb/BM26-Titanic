// Industrial dark theme for PortWatch.
//
// Designed for outdoor visibility: high-contrast neutrals + a small set
// of saturated accents per command group. The accents are deliberately
// drawn from Tailwind's `*-300` family, which is the brightest tier
// that still passes WCAG AA against the near-black surfaces below.

export const C = {
  // Surfaces — black-on-black-on-black ladder. Backgrounds get darker
  // as you nest, so a stack of cards has visible depth without
  // outlines doing all the work.
  bg: "#0a0a0a",          // root background
  card: "#161616",        // primary card surface
  cardActive: "#202020",  // pressed / hovered card
  cardSunken: "#0f0f0f",  // wells inside cards (e.g. stat readouts)
  border: "#2a2a2a",
  borderStrong: "#3a3a3a",

  // Type
  text: "#e9e9e9",
  textDim: "#888",
  textMuted: "#5a5a5a",
  textInverse: "#0a0a0a",

  // Accent / state
  accent: "#7dd3fc",      // sky-300 — primary highlight
  accentDeep: "#0284c7",
  ok: "#86efac",          // green-300 — connected, healthy
  warn: "#fde68a",        // amber-200 — degraded, slow, pending
  err: "#fca5a5",         // red-300 — error, nak, disconnected
  pubBlue: "#a5b4fc",     // indigo-300 — pubs / broadcasts

  // Per-domain accents (groups of related controls share a colour)
  pattern: "#a78bfa",     // purple — patterns
  brightness: "#fbbf24",  // amber — master brightness
  autopilot: "#f472b6",   // pink — autopilot
  // Blackout matches the saturated red used by CaptainPad
  // (#ba1a1a, Material error 700) and the engine's globals UI, so
  // an operator looking at any of the three surfaces sees the same
  // colour mean "the rig is muted". We use red-600 here rather than
  // CaptainPad's exact 700 because PortWatch's near-black surfaces
  // need slightly more saturation to pop while still keeping
  // contrast against the cyan accent and pink autopilot pill.
  blackout: "#dc2626",    // red-600 — global blackout (matches CaptainPad/engine)
  fx: "#34d399",          // emerald — fx macros
  horn: "#fb923c",        // orange — horn
  pyro: "#ef4444",        // red-500 — pyro (always disabled, slightly lighter so it reads disabled)
  param: "#22d3ee",       // cyan — CPC params
  query: "#fcd34d",       // yellow — queries
  link: "#fda4af",        // rose — link / ping
};

export const F = {
  display: 32,
  title: 20,
  subtitle: 16,
  body: 15,
  small: 12,
  micro: 10,
  mono: 13,
};

export const S = {
  // Spacing scale — 4 dp grid, used everywhere padding/gap is set.
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const R = {
  // Border radii — cards always 12, chips/pills always 6.
  card: 12,
  pill: 6,
  hero: 16,
};
