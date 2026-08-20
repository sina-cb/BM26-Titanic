/**
 * vis_budget — the `/ws/viz` broadcast budget, resolved from `config.yaml`.
 *
 * ── WHY THIS EXISTS (report _239) ───────────────────────────────────────────
 *
 * The vis broadcast is ADVISORY: it feeds CaptainPad's previews and never
 * touches sACN. It used to carry ONE cap (`vis.maxPixels`, default 100)
 * applied uniformly to every key in the frame, because every consumer was a
 * <PixelStrip> — an RN <View> per sample per channel, which is exactly the
 * cost that cap exists to bound.
 *
 * That stopped being true when the Deck grew its PIXELS window (_225): a raw
 * 2D canvas that draws the SIMULATION's pixel map, one glyph per model pixel.
 * It reads `preDimmer` / `rig` and its colour fidelity is the transmitted
 * sample count — 100 samples spread over a 964-pixel model, which the window
 * had to declare on screen as "100/964 COLOUR SAMPLES".
 *
 * The two consumers want opposite things from the SAME broadcast, so the cap
 * became PER KEY:
 *
 *   * per-CHANNEL keys stay cheap (one strip each, N channels open at once);
 *   * the whole-rig composite keys (`rig`, `preDimmer`) can run full rate,
 *     because their consumer is a canvas whose cost is per PIXEL DRAWN, not
 *     per sample received.
 *
 * ── THE CONFIG SHAPE ────────────────────────────────────────────────────────
 *
 *   vis:
 *     broadcastHz: 5
 *     maxPixels: 100          # the DEFAULT budget, every key not named below
 *     keyMaxPixels:           # per-key overrides — integer, or 'full'
 *       rig: full
 *       preDimmer: full
 *
 * `full` means "send the model verbatim, no subsampling".
 *
 * ── VALIDATION IS LOUD (codex P0 — no fallbacks) ────────────────────────────
 *
 * An ABSENT field takes its documented default. A field that is PRESENT but
 * unreadable — a typo'd key name, a negative cap, a string that isn't 'full',
 * an unknown member of the `vis:` block — THROWS at boot with the valid set
 * named. A silently-ignored `maxPixel: 900` typo would leave the operator
 * staring at a window that never sharpened, wondering which layer lied.
 *
 * `keyMaxPixels` may only name the engine's own fixed WHOLE-RIG vis keys
 * (below). Per-channel keys are runtime channel ids — naming one in a config
 * file would bind the file to a channel that may not exist next boot — so they
 * always take the default budget, and naming one throws.
 */

/**
 * The vis keys that are NOT per-channel: every one of these carries a whole-rig
 * composite, and only these may be named in `vis.keyMaxPixels`.
 *
 *   master            — the pre-dimmer composition, set by pattern_mixer
 *   preDimmer         — after global FX, before section dimmers + blackout
 *   rig               — post-dimmer, post-blackout hardware truth
 *   __deck_inactive__ — the deck's incoming/outgoing side during a transition
 *   __deck_swap__     — the deck swap preview
 */
export const VIS_COMPOSITE_KEYS = Object.freeze([
  'master',
  'preDimmer',
  'rig',
  '__deck_inactive__',
  '__deck_swap__',
]);

/** The literal that means "no subsampling — send every model pixel". */
export const VIS_FULL_RATE = 'full';

/** Fields allowed inside the `vis:` config block. Anything else throws. */
export const VIS_CONFIG_FIELDS = Object.freeze(['broadcastHz', 'maxPixels', 'keyMaxPixels']);

/** Documented defaults, used when (and only when) the field is absent. */
export const DEFAULT_BROADCAST_HZ = 1;
export const DEFAULT_MAX_PIXELS = 100;

function fail(message) {
  throw new Error(`[vis config] ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read one budget value: a positive integer, or the string 'full' (→ Infinity).
 * `where` names the config path for the error message.
 */
function readBudget(value, where) {
  if (value === VIS_FULL_RATE) return Infinity;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${where} must be a positive integer or the string '${VIS_FULL_RATE}', ` +
      `got ${JSON.stringify(value)}`);
  }
  if (!Number.isInteger(value) || value < 1) {
    fail(`${where} must be a positive integer or the string '${VIS_FULL_RATE}', got ${value}`);
  }
  return value;
}

/**
 * Resolve the `vis:` block into a budget plan. Pure — no I/O, no engine state —
 * so the whole contract is unit-testable without booting a render loop.
 *
 * @param {object|undefined} visConfig  the raw `config.yaml` → `vis:` mapping
 * @returns {{broadcastHz:number, intervalMs:number, defaultMaxPixels:number,
 *            keyMaxPixels:Map<string,number>, budgetForKey:(key:string)=>number}}
 */
export function resolveVisConfig(visConfig) {
  const raw = visConfig === undefined || visConfig === null ? {} : visConfig;
  if (!isPlainObject(raw)) {
    fail(`vis must be a mapping, got ${JSON.stringify(raw)}`);
  }
  for (const field of Object.keys(raw)) {
    if (!VIS_CONFIG_FIELDS.includes(field)) {
      fail(`unknown field vis.${field} — valid fields are ${VIS_CONFIG_FIELDS.join(', ')}`);
    }
  }

  let broadcastHz = DEFAULT_BROADCAST_HZ;
  if (raw.broadcastHz !== undefined) {
    if (typeof raw.broadcastHz !== 'number' || !Number.isFinite(raw.broadcastHz)
      || raw.broadcastHz <= 0) {
      fail(`vis.broadcastHz must be a positive number, got ${JSON.stringify(raw.broadcastHz)}`);
    }
    broadcastHz = raw.broadcastHz;
  }

  let defaultMaxPixels = DEFAULT_MAX_PIXELS;
  if (raw.maxPixels !== undefined) {
    defaultMaxPixels = readBudget(raw.maxPixels, 'vis.maxPixels');
  }

  const keyMaxPixels = new Map();
  if (raw.keyMaxPixels !== undefined) {
    if (!isPlainObject(raw.keyMaxPixels)) {
      fail(`vis.keyMaxPixels must be a mapping of vis key → budget, ` +
        `got ${JSON.stringify(raw.keyMaxPixels)}`);
    }
    for (const [key, value] of Object.entries(raw.keyMaxPixels)) {
      if (!VIS_COMPOSITE_KEYS.includes(key)) {
        fail(`vis.keyMaxPixels names '${key}', which is not a whole-rig vis key — ` +
          `valid keys are ${VIS_COMPOSITE_KEYS.join(', ')}. Per-channel keys are ` +
          'runtime channel ids and always take vis.maxPixels.');
      }
      keyMaxPixels.set(key, readBudget(value, `vis.keyMaxPixels.${key}`));
    }
  }

  return {
    broadcastHz,
    intervalMs: Math.max(1, Math.round(1000 / broadcastHz)),
    defaultMaxPixels,
    keyMaxPixels,
    budgetForKey(key) {
      return keyMaxPixels.has(key) ? keyMaxPixels.get(key) : defaultMaxPixels;
    },
  };
}

/**
 * Build the per-budget sampling machinery for a model of `pixelCount` pixels.
 *
 * One index table + one scratch buffer per DISTINCT budget (so `rig` and
 * `preDimmer` at the same budget share, and eight channels at the default
 * budget share one table). Built lazily on first use of each budget and then
 * reused for the life of the engine — the hot path allocates nothing.
 *
 * The sampling rule is unchanged from the single-cap era:
 *   sampleIdx[i] = floor(i * pixelCount / budget)
 * so CaptainPad's existing inverse (`sampleIndexForModelPixel`) still holds.
 *
 * @param {number} pixelCount  the model's true pixel count
 * @param {{budgetForKey:(key:string)=>number}} plan  from resolveVisConfig()
 */
export function createVisSampler(pixelCount, plan) {
  if (!Number.isInteger(pixelCount) || pixelCount < 1) {
    fail(`sampler needs a positive integer pixelCount, got ${pixelCount}`);
  }
  /** budget → { idx: Int32Array|null, scratch: Uint8Array|null, outPixels } */
  const tables = new Map();

  function tableFor(budget) {
    const existing = tables.get(budget);
    if (existing) return existing;
    let table;
    if (!(pixelCount > budget)) {
      // Model already fits — the buffer is shipped verbatim, no copy at all.
      table = { idx: null, scratch: null, outPixels: pixelCount };
    } else {
      const idx = new Int32Array(budget);
      for (let i = 0; i < budget; i++) idx[i] = Math.floor(i * pixelCount / budget);
      table = { idx, scratch: new Uint8Array(budget * 6), outPixels: budget };
    }
    tables.set(budget, table);
    return table;
  }

  return {
    /** How many samples this key's buffer will carry. */
    outputPixelsFor(key) {
      return tableFor(plan.budgetForKey(key)).outPixels;
    },
    /** How many samples a key with no override carries (per-channel keys). */
    defaultOutputPixels() {
      return tableFor(plan.defaultMaxPixels).outPixels;
    },
    /**
     * Subsample `full6ch` for `key`. Returns either the input buffer itself
     * (full rate) or a SHARED scratch buffer — the caller MUST encode the
     * result before the next call, exactly as before.
     */
    sample(key, full6ch) {
      const table = tableFor(plan.budgetForKey(key));
      if (!table.idx) return full6ch;
      const { idx, scratch } = table;
      for (let i = 0; i < idx.length; i++) {
        const src = idx[i] * 6;
        const dst = i * 6;
        scratch[dst] = full6ch[src];
        scratch[dst + 1] = full6ch[src + 1];
        scratch[dst + 2] = full6ch[src + 2];
        scratch[dst + 3] = full6ch[src + 3];
        scratch[dst + 4] = full6ch[src + 4];
        scratch[dst + 5] = full6ch[src + 5];
      }
      return scratch;
    },
  };
}

/**
 * One human line for the boot banner: what the operator is actually shipping.
 */
export function describeVisPlan(plan, sampler, pixelCount) {
  const parts = [`${plan.broadcastHz} Hz`, `${sampler.defaultOutputPixels()} px/strip`];
  for (const key of VIS_COMPOSITE_KEYS) {
    if (!plan.keyMaxPixels.has(key)) continue;
    const out = sampler.outputPixelsFor(key);
    parts.push(`${key} ${out}${out < pixelCount ? `/${pixelCount}` : ' (full)'}`);
  }
  return `${parts.join(' · ')} · model ${pixelCount} px`;
}

