/**
 * live_touch_overhaul_shots — docs/70 (report `_288`) capture harness.
 *
 * Reproduces the EXACT framing of the `_284` "before" shots so after-images
 * diff honestly: scratch CaptainPad dist -> Touch Control tab -> iframe to the
 * sim-served panel -> live engine. DISARMED throughout; this script never
 * writes to the engine.
 *
 * Viewports are the docs/66 acceptance pair (11"): 834x1194 portrait and
 * 1194x834 landscape. Console is muted before boot or captures starve
 * (memory: captainpad-screenshot-technique).
 *
 * Usage: node live_touch_overhaul_shots.cjs --pad 7172 --out <dir> [--tag after]
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const PAD_PORT = Number(arg('--pad', '7172'));
const HOME = process.env.HOME || process.env.USERPROFILE;
const TAG = arg('--tag', 'after');
const OUT = arg('--out', path.join(HOME, 'tmp', 'live_touch_impl', 'shots', TAG));
const BASE = `http://127.0.0.1:${PAD_PORT}`;
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  portrait: { width: 834, height: 1194 },
  landscape: { width: 1194, height: 834 },
};

const findings = [];
function record(name, ok, detail) {
  findings.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/** The panel lives inside the tab's iframe; every probe runs in that frame. */
async function panelFrame(page) {
  for (let i = 0; i < 40; i += 1) {
    const frame = page.frames().find((f) => f.url().includes('touch_control.html'));
    if (frame) {
      const ready = await frame
        .evaluate(() => !!document.querySelector('.topbar'))
        .catch(() => false);
      if (ready) return frame;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('panel iframe never became ready');
}

async function shoot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`        shot: ${file}`);
  return file;
}

/**
 * Geometry probe run INSIDE the panel frame. Returns the numbers the F1-F8
 * proof matrix is scored against — overlaps, hit-target census, mode state.
 */
const PROBE = () => {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  };
  const overlaps = (a, b) =>
    a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;

  const out = { viewport: { w: innerWidth, h: innerHeight } };

  // F1 — header collision: brand vs ARM vs status cluster.
  const brand = document.querySelector('.brand');
  const arm = document.querySelector('#arm');
  const statusChip = document.querySelector('.top-actions .chip:not(.chip-ico)');
  out.header = {
    brand: brand ? rect(brand) : null,
    arm: arm ? rect(arm) : null,
    status: statusChip ? rect(statusChip) : null,
  };
  out.header.brandOverlapsArm =
    brand && arm ? overlaps(rect(brand), rect(arm)) : null;
  out.header.armOverlapsStatus =
    arm && statusChip ? overlaps(rect(arm), rect(statusChip)) : null;
  // The <h1> is the thing that actually spills; measure its painted box too.
  const h1 = document.querySelector('.brand h1');
  out.header.h1 = h1 ? rect(h1) : null;
  out.header.h1OverlapsArm = h1 && arm ? overlaps(rect(h1), rect(arm)) : null;
  out.header.h1Scrolls = h1 ? h1.scrollWidth > h1.clientWidth + 1 : null;
  /* Fixing the F1 overlap by clamping `.brand` hard enough to render
     "TO..." trades one unfinished-looking header for another. `text-overflow:
     ellipsis` truncates the <h1>'s content AS A WHOLE (the "#44" span lives
     INSIDE it), so an over-tight clamp silently eats the entire wordmark.
     Require that enough of the title survives to read as a title. */
  out.header.h1Text = h1 ? (h1.textContent || '').trim() : null;
  out.header.h1Visible = h1
    ? Math.round(h1.getBoundingClientRect().width)
    : null;
  out.header.h1Legible = h1
    ? h1.getBoundingClientRect().width >= 90
    : null;

  // F3 — which mode is active on boot, and how the predicate can read it.
  const modeBtns = [...document.querySelectorAll('.mode-toggle button, [data-mode]')];
  out.modes = modeBtns.map((b) => ({
    text: (b.textContent || '').trim(),
    dataMode: b.getAttribute('data-mode'),
    active: b.classList.contains('is-active'),
    ...rect(b),
  }));

  /* F5 / docs/66 §2.1 — 44pt HIT-REGION census, not a box-size census.
     The doctrine is explicit that the floor applies to the hit region, not
     the painted box, and the sanctioned recipe is a transparent `::after`
     overlay that expands reach without touching the layout budget (growing
     real boxes here regressed a _268-pinned pad win — see the W4 P4 note at
     touch_control.html:498). A plain getBoundingClientRect() census cannot
     see a pseudo-element overlay at all, so it would score a CORRECT fix as
     a failure and push the implementer straight back into that trap. */
  const SEL = 'button, select, [role="button"], [role="switch"], .chip, .pill, input';
  const controls = [...document.querySelectorAll(SEL)].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  });
  /* Effective hit rect = union(border box, ::after overlay box).

     This is the doctrine's rule as written ("the palette slot rows draw a
     32px swatch inside a 46px [data-slot] row and PASS") — a property of the
     control ITSELF. Cardinal-point sampling was tried first and rejected: it
     silently folds in a SECOND property (are neighbours >=44px apart), which
     dense chip rows can never satisfy since adjacent overlays must overlap,
     so it reports unreachable failures and would push the fix back toward
     growing real boxes — the exact _268-pinned regression to avoid.

     Absolute-positioned ::after insets may be negative to expand reach; a
     px inset resolves against the padding box, an `auto` inset means that
     edge does not move. */
  const afterExtent = (el) => {
    const cs = getComputedStyle(el, '::after');
    if (!cs || cs.content === 'none' || cs.position !== 'absolute') return null;
    const r = el.getBoundingClientRect();
    const num = (v) => (v && v !== 'auto' && v.endsWith('px') ? parseFloat(v) : null);
    const t = num(cs.top); const b = num(cs.bottom);
    const l = num(cs.left); const rt = num(cs.right);
    return {
      top: t === null ? r.top : r.top + t,
      bottom: b === null ? r.bottom : r.bottom - b,
      left: l === null ? r.left : r.left + l,
      right: rt === null ? r.right : r.right - rt,
    };
  };
  const effectiveRect = (el) => {
    const r = el.getBoundingClientRect();
    const a = afterExtent(el);
    if (!a) return { w: r.width, h: r.height };
    return {
      w: Math.max(r.right, a.right) - Math.min(r.left, a.left),
      h: Math.max(r.bottom, a.bottom) - Math.min(r.top, a.top),
    };
  };
  const under = controls
    .map((el) => ({ el, eff: effectiveRect(el), box: el.getBoundingClientRect() }))
    .filter(({ eff }) => eff.h < 44 || eff.w < 44)
    .map(({ el, eff, box }) => ({
      tag: el.tagName.toLowerCase(),
      cls: el.className && String(el.className).slice(0, 48),
      text: (el.textContent || '').trim().slice(0, 24),
      boxW: Math.round(box.width),
      boxH: Math.round(box.height),
      effW: Math.round(eff.w),
      effH: Math.round(eff.h),
    }));
  // Box census kept alongside, for information only — it is NOT the gate.
  const boxUnder = controls.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height < 44 || r.width < 44;
  }).length;
  out.hitTargets = {
    total: controls.length,
    under44: under.length,
    boxUnder44: boxUnder,
    method: 'effective hit rect = union(border box, ::after overlay)',
    offenders: under.slice(0, 40),
  };

  // F4 — cross-mode residue captions.
  const bodyText = document.body.innerText || '';
  out.residue = {
    shownInSpatial: bodyText.includes('SHOWN IN SPATIAL MODE'),
    shownInXy: bodyText.includes('SHOWN IN XY MODE'),
  };

  // F2/D1 — naming + priority.
  out.copy = {
    poolVisible: bodyText.includes('POOL'),
    invertVisible: bodyText.includes('INVERT'),
    xyModeVisible: bodyText.includes('XY MODE'),
    effectControlVisible: bodyText.includes('EFFECT CONTROL'),
  };

  // F7 — raw telemetry in the audio rail.
  out.audioRail = { text: (document.querySelector('.meter-strip') || {}).innerText || null };

  /* F2 — who owns the viewport: the pad the operator performs on, or the
     legacy colour wheel. The whole priority inversion is that the wheel was
     the hero and the pad the tenant. A docked legacy panel contributes zero
     area, which is what D8 is for. */
  const pad = document.querySelector('#xyPad, .xy-frame, .spatial-frame');
  const wheel = document.querySelector('.color-wheel-col, .wheel-wrap');
  const visible = (el) => {
    if (!el) return false;
    if (el.closest('.panel.is-docked')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const area = (el) => (visible(el) ? Math.round(el.getBoundingClientRect().width
    * el.getBoundingClientRect().height) : 0);
  out.priority = {
    padArea: area(pad),
    wheelArea: area(wheel),
    viewportArea: innerWidth * innerHeight,
    /* Area alone under-reports F2. The defect docs/70 §1 describes is
       POSITIONAL: the wheel owns the top of portrait and the pad "starts
       below the fold", so the surface the operator performs on is the least
       visible thing on it. A pad that is large but off-screen is still the
       tenant. Measure where the pad STARTS, as a fraction of the viewport. */
    padTopFrac: visible(pad)
      ? Number((pad.getBoundingClientRect().top / innerHeight).toFixed(3))
      : null,
  };

  // D8 — the legacy COLOR panel ships docked on FRESH layout state (each
  // capture runs a clean profile, so this reads the fresh-boot default).
  const legacy = document.querySelector('.color-panel');
  out.legacyColor = {
    present: !!legacy,
    docked: legacy ? legacy.classList.contains('is-docked') : null,
    railTabLabels: [...document.querySelectorAll('.rail-tab')]
      .map((t) => (t.textContent || '').trim()),
  };
  /* D8 docks the LEGACY panel — it must not also dock the NEW one. docs/70
     §4.2 makes the three-card daemon panel "the main colour surface", so a
     boot where BOTH are docked leaves the operator with no colour control at
     all: a strictly worse surface than the one this wave set out to fix.
     Identified by eye from the capture, then gated here. */
  const panelTitleText = (p) => {
    const t = p.querySelector('.panel-title, h2');
    return t ? (t.textContent || '').trim().toUpperCase() : '';
  };
  const mainColor = [...document.querySelectorAll('.panel')].find((p) => {
    const t = panelTitleText(p);
    return t.includes('COLOR') && !t.includes('LEGACY');
  });
  out.mainColor = {
    present: !!mainColor,
    docked: mainColor ? mainColor.classList.contains('is-docked') : null,
    cards: mainColor
      ? [...mainColor.querySelectorAll('[data-color-card], .color-card')]
        .map((c) => (c.getAttribute('data-color-card')
          || (c.textContent || '').trim().slice(0, 24)))
      : [],
  };

  // W2 — the background picker: ambient entries, and no parameter UI for them.
  const picker = document.querySelector('#patternSel');
  out.picker = picker
    ? {
      optionCount: picker.options.length,
      groups: [...picker.querySelectorAll('optgroup')].map((g) => g.label),
      sample: [...picker.options].slice(0, 4).map((o) => o.textContent.trim()),
    }
    : null;

  // W4 — the presets surface, engine-backed rather than a localStorage grid.
  const presets = document.querySelector('#presetsPanel');
  out.presets = presets
    ? {
      docked: presets.classList.contains('is-docked'),
      rowCount: presets.querySelectorAll('[data-preset-id]').length,
      text: (presets.innerText || '').slice(0, 120).replace(/\s+/g, ' '),
    }
    : null;
  return out;
};

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    for (const [orientation, vp] of Object.entries(VIEWPORTS)) {
      const page = await browser.newPage();
      // MUST precede navigation — console spam starves the capture path.
      await page.evaluateOnNewDocument(() => {
        console.log = console.debug = console.info = () => {};
      });
      await page.setViewport({ ...vp, deviceScaleFactor: 2 });
      await page.goto(`${BASE}/(tabs)/touch_control`, { waitUntil: 'networkidle2', timeout: 60000 });
      const frame = await panelFrame(page);
      await new Promise((r) => setTimeout(r, 2500));

      await shoot(page, `${orientation}_01_default`);
      const probe = await frame.evaluate(PROBE);
      fs.writeFileSync(
        path.join(OUT, `${orientation}_probe.json`),
        JSON.stringify(probe, null, 2),
      );

      record(
        `${orientation} F1 header: brand/h1 does not overlap ARM`,
        probe.header.h1OverlapsArm === false && probe.header.brandOverlapsArm === false,
        `h1xARM=${probe.header.h1OverlapsArm} brandxARM=${probe.header.brandOverlapsArm}`,
      );
      record(
        `${orientation} F1 header: title stays legible (not clamped to "TO...")`,
        probe.header.h1Legible === true,
        `h1 renders ${probe.header.h1Visible}px wide, needs >=90`,
      );
      record(
        `${orientation} F7 audio rail shows labels, not raw meter keys`,
        !/\bmic(Low|Mid|High|Kick|Flux|DomF)/.test(probe.audioRail.text || ''),
        `rail text starts: ${(probe.audioRail.text || '').slice(0, 60).replace(/\s+/g, ' ')}`,
      );
      const activeMode = (probe.modes.find((m) => m.active) || {});
      record(
        `${orientation} F3 boot mode is SPATIAL`,
        activeMode.dataMode === 'spatial',
        `active=${activeMode.text || 'none'} data-mode=${activeMode.dataMode}`,
      );
      record(
        `${orientation} F4 no cross-mode residue captions`,
        !probe.residue.shownInSpatial && !probe.residue.shownInXy,
        `spatial=${probe.residue.shownInSpatial} xy=${probe.residue.shownInXy}`,
      );
      record(
        `${orientation} D1 POOL renamed to INVERT in visible copy`,
        !probe.copy.poolVisible && probe.copy.invertVisible,
        `pool=${probe.copy.poolVisible} invert=${probe.copy.invertVisible}`,
      );
      record(
        `${orientation} D8 legacy COLOR ships docked on fresh state`,
        probe.legacyColor.docked === true,
        `docked=${probe.legacyColor.docked}, rail tabs: ${probe.legacyColor.railTabLabels.join('/') || 'none'}`,
      );
      record(
        `${orientation} W3 the main COLOR panel is present and OPEN on boot`,
        probe.mainColor.present === true && probe.mainColor.docked === false,
        `present=${probe.mainColor.present} docked=${probe.mainColor.docked}`
          + ` cards=[${probe.mainColor.cards.join(', ')}]`,
      );
      record(
        `${orientation} F2 the pad is the hero, not the tenant`,
        probe.priority.padArea > probe.priority.wheelArea
          && probe.priority.padTopFrac !== null
          && probe.priority.padTopFrac < 0.5,
        `pad starts at ${probe.priority.padTopFrac === null ? 'n/a'
          : `${Math.round(probe.priority.padTopFrac * 100)}% down`}`
          + ` (needs <50%); pad=${probe.priority.padArea}px2 wheel=${probe.priority.wheelArea}px2`,
      );
      record(
        `${orientation} W2 picker offers ambient backgrounds`,
        !!probe.picker && probe.picker.optionCount > 3,
        probe.picker
          ? `${probe.picker.optionCount} options, groups: ${probe.picker.groups.join('/') || 'none'}`
          : 'no picker found',
      );
      record(
        `${orientation} F5 every control >= 44pt hit region`,
        probe.hitTargets.under44 === 0,
        `${probe.hitTargets.under44}/${probe.hitTargets.total} fail 44pt hit region`
          + ` (box-only census: ${probe.hitTargets.boxUnder44} — informational)`,
      );

      await page.close();
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(
    path.join(OUT, 'findings.json'),
    JSON.stringify(findings, null, 2),
  );
  const failed = findings.filter((f) => !f.ok);
  console.log(`\n${findings.length - failed.length}/${findings.length} checks passed`);
  if (failed.length) {
    console.log('FAILING:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
})().catch((error) => {
  console.error('CAPTURE FAILED:', error.message);
  process.exit(1);
});
