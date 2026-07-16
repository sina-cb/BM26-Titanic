/**
 * device_config_mapper.test.js — the legacy single-base DEVICE-LINEAR layout
 * (`computeLinearLayout`) was REMOVED when per-output became the only device
 * model (operator ruling 2026-07-10/11). Its golden + edge coverage now lives on
 * the per-output path:
 *
 *  - contiguous / disabled-middle placement  → led_patch_projection.test.js and
 *    pixelblaze_model_exporter_local_index.test.js (device-bound cases).
 *  - >128px spill / no-straddle walk          → led_patch_projection.test.js
 *    (projectLedStrandSegments L1 cases) + per_output_push.test.js (NO OVERLAP).
 *  - universe-ceiling overflow                → led_patch_projection.test.js
 *    (led_universe_overflow) + per_output_push.test.js (RANGE).
 *  - unknown colorOrder / bad LED config       → controller_registry.test.js
 *    (normalizeLedConfig throws on unknown channel order).
 *
 * device_config_mapper.js's SURVIVING pure functions (`derivePerOutputPlan`,
 * `autoAssignPerOutputUniverses`) are covered in per_output_push.test.js. Nothing
 * left in this module needs its own golden here; this file is kept as a glob
 * target (tests/*.test.js) documenting where the linear-layout coverage moved.
 */
