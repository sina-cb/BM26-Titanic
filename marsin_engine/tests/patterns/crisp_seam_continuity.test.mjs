import assert from 'node:assert/strict';
import test from 'node:test';

import { auditCrispSeams } from '../../tools/crisp_seam_audit.mjs';

test('every Crisp clock crosses its real wrap without a reset seam',
  { timeout: 60_000 }, async () => {
    const results = await auditCrispSeams();
    for (const [pattern, models] of Object.entries(results)) {
      for (const [model, boundaries] of Object.entries(models)) {
        assert.ok(boundaries.length >= 3, `${pattern}/${model}: no boundaries audited`);
        for (const result of boundaries) {
          // A ratio alone is unstable on sparse models when the natural-next
          // frame is almost motionless. Require both excess ratio and a
          // four-percent full-scale mean change before calling a visible seam;
          // large single-pixel jumps are guarded independently below.
          const ratioIsPerceptible = result.meanExcessRatio > 1.65 &&
            result.boundary.meanAbsolute > 0.04;
          assert.ok(!ratioIsPerceptible,
            `${pattern}/${model}/${result.clock}/speed=${result.speed}: ` +
            `boundary mean delta is ${result.meanExcessRatio.toFixed(3)}x natural next ` +
            `at ${(result.boundary.meanAbsolute * 100).toFixed(2)}% full scale`);
          assert.ok(result.largeJumpExcess <= 0.08,
            `${pattern}/${model}/${result.clock}/speed=${result.speed}: ` +
            `boundary adds ${(result.largeJumpExcess * 100).toFixed(2)}% large jumps`);
        }
      }
    }
  });
