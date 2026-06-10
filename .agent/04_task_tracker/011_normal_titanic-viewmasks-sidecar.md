# Author a titanic.viewmasks.js sidecar with composite presets

- **ID:** 011
- **Priority:** NORMAL
- **Status:** OPEN
- **Source:** .agent/02_reports/202606/20260610_2_dynamic_group_bits.md
- **Location:** marsin_engine/models/ (new file: titanic.viewmasks.js)
- **Created:** 2026-06-10
- **Updated:** 2026-06-10

## Description
The engine now derives base group→bit assignments dynamically from the
model, so the titanic's 30 groups all have real `vMask` bits — but the
model has no `.viewmasks.js` sidecar yet, so CaptainPad's "VIEW MASKS"
picker section is empty and patterns can't target named composites.

With the new sidecar format, composites are one-liners by group name,
e.g.:

```javascript
export const viewMasks = [
  { name: 'Bergs',      groups: ['Berg Alpha', 'Berg Beta', 'Berg Gamma', 'Berg Delta'] },
  { name: 'Chimneys',   groups: ['Right Top Chimney Generator', 'Left Top Chimney Generator'] },
  { name: 'SmallSails', groups: ['Small_Left_1', /* ... */ 'Small_Right_4'] },
];
```

Pick the actual preset list with Sina — these are creative groupings
for the operator surface, not a technical decision.

## Why it matters
Named view masks are how the operator layers patterns onto sections of
the ship from CaptainPad. Mission-critical exterior visibility shows
will want at-least Bergs/hull/sails-level composites.

## Follow-up (stretch)
Consider injecting `MASK_<NAME>` constants into pattern source at
compile time from the model's resolved viewMasks, so patterns stop
hardcoding preset bit values (Logsville patterns 70–117 hardcode
`MASK_REDWOOD_PARS = 64` / `MASK_VINTAGE_ONLY = 128` today, which is
why those two bits stay explicitly declared in the sidecar).
