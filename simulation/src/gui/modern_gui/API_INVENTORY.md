# MarsinGui API Inventory

Exhaustive inventory of every lil-gui API surface used by the two builders
(`src/gui/gui_builder.js`, `src/gui/pattern_editor.js`), the schema oracle
(`src/gui/control_schema.js`), and the entry point (`main.js`). MarsinGui
implements exactly this surface with lil-gui **0.17.0** semantics (the
vendored build at `vendor/three/examples/jsm/libs/lil-gui.module.min.js`).

Anything outside this inventory either keeps its faithful lil-gui
implementation (when trivially cheap: `reset`, `load`, `save`, `options`)
or throws `MarsinGui: <method> not implemented`.

## 1. GUI constructor

| Usage | Where |
|---|---|
| `new GUI({ title: "🔦 Lighting Controls", width: 300 })` | gui_builder.js:175 |
| `new GUI({ title: '🎛️ Engine Parameters' })` | pattern_editor.js:257 |

Semantics: no `container`/`parent` → root, `autoPlace` default true → class
`autoPlace` + appended to `document.body`; `width` → `--width` CSS custom
property on the root element; root registers `keydown`/`keyup`
`stopPropagation` listeners (lil-gui 0.17 behavior).

## 2. GUI / folder members

| Member | Call sites (file:line) |
|---|---|
| `gui.hide()` | gui_builder.js:177 |
| `gui.domElement` (style.position/top/right resets, `classList.remove('autoPlace')`, `id`, `style.zIndex`, `style.display`, `style.top/left`) | gui_builder.js:212-215, 961-962; pattern_editor.js:258-273 |
| `gui.domElement.querySelector(':scope > .title')` | gui_builder.js:217 |
| `gui.domElement.querySelector('.children')` | gui_builder.js:3884; folders: 892, 940, 1010, 1259, 1274, 1385, 1467, 1541, 1879, 1952, 2019, 2082, 2877, 3161, 3244, 3345, 3366, 3455, 3515, 3532, 3714, 3808, 3825 |
| `folder.domElement.querySelector('.title')` (+ `addEventListener('click')`) | gui_builder.js:1493, 1892, 2950, 3267, 3731 |
| `folder.domElement.classList` add/remove `gui-card`, `gui-card-selected` | gui_builder.js:1476, 1814, 2815, 2819, 2905-2928, 3253, 3419-3423, 3467-3478, 3673-3740 |
| `gui.onChange(cb)` (root-level, event bus) | gui_builder.js:480 |
| `gui.onFinishChange(cb)` (root-level; guarded `typeof === 'function'`) | gui_builder.js:469-470 |
| `gui.addFolder(title)` | gui_builder.js:861, 873, 899, 947, 1039, 1109, 1133, 1193, 1211, 1425, 1475, 1813, 1925, 1938, 2118, 2944, 3001, 3006, 3067, 3077, 3188, 3242, 3252, 3317, 3329, 3379, 3503, 3508, 3544, 3598, 3725, 3751, 3758, 3769, 3784, 3791, 3799; pattern_editor.js:279, 367 |
| `folder.add(obj, prop)` (boolean/string/plain number) | gui_builder.js:826, 834, 1157, 1499, 1897, 2888, 2894, 2958, 2975, 3016, 3191, 3272, 3384, 3483, 3569, 3573, 3747, 3771, 3776, 3793; pattern_editor.js:377, 384, 387, 391 |
| `folder.add(obj, prop, min, max, step?)` (number → fader) | gui_builder.js:831, 1521-1531, 1908-1947, 2984-3010, 3019, 3070-3081, 3304-3338, 3493-3512, 3558-3561, 3600, 3748-3803; pattern_editor.js:289, 296, 373, 394 |
| `folder.add(obj, prop, arrayOrObject)` (option) | gui_builder.js:828, 1137, 1162, 2090, 2970, 3036, 3295, 3786 |
| `folder.addColor(obj, prop)` | gui_builder.js:824, 905, 1516, 1903, 3069, 3304, 3488, 3599, 3781, 3788, 3794 |
| `folder.open()` / `folder.close()` / `gui.close()` | gui_builder.js:862, 1040, 1110, 1134, 1194, 1224, 1264, 1433-1435, 1477, 1815, 1926, 1939, 2118-2119, 2813, 2818, 2902, 2909, 2946, 3002, 3007, 3068, 3078, 3188-3189, 3243, 3254, 3318, 3330, 3380, 3417, 3422, 3428, 3468, 3504, 3509, 3545, 3671, 3676, 3727, 3752, 3759, 3770, 3785, 3792, 3800, 3891 |
| `folder._closed` | gui_builder.js:255, 1265, 1494, 1894, 3269 |
| `folder._title` | gui_builder.js:1265 |
| `folder.title(v)` (setter) | gui_builder.js:1500, 1898, 2960, 3273 |
| `gui._title` / `gui.$title` (schema oracle) | control_schema.js:51 |
| `folder.folders` | gui_builder.js:1224, 1264, 1268, 2824, 3247, 3428, 3686 |
| `folder.controllers` (+ `.find(c => c.property === …)`) | gui_builder.js:2886, 2892 |
| `gui.children` (schema tree walk; child discrimination via `children !== undefined && folders !== undefined`) | control_schema.js:54-55 |
| `folder.destroy()` | gui_builder.js:898, 1269, 2825, 3248, 3429, 3687; pattern_editor.js:310, 328 |
| `folder.controllersRecursive()` | gui_builder.js:3105; main.js:432, 444 |
| `folder.onOpenClose` — **probed with `typeof === 'function'` only** | gui_builder.js:1490, 1889, 3264, 3472 — lil-gui 0.17 has NO `onOpenClose`, so legacy takes the `else` branch (`.title` click listeners). MarsinGui deliberately does NOT implement it, preserving legacy control flow. |

Not used by the builders but kept (trivial, lil-gui-identical): `show()`,
`openAnimated()`, `reset()`, `foldersRecursive()`, `load()`, `save()`.

## 3. Controller members

| Member | Call sites |
|---|---|
| `.name(label)` | gui_builder.js:824-834, 1138, 1159, 1163, 1178, 1191, 2090-2113, 2888-2894, 2958-3081, 3191, 3272-3338, 3384-3512, 3549-3600, 3747-3803; pattern_editor.js:296, 394 |
| `.onChange(cb)` | gui_builder.js:837, 844, 905, 986, 1007, 1139, 1159, 1164, 1516-1531, 1903-1947, 2888-2894, 2958-3081, 3191-3338, 3384-3512, 3549-3600, 3747-3803; pattern_editor.js:290, 297, 374, 378, 388, 395 |
| `.onFinishChange(cb)` | gui_builder.js:1499, 1897, 2958, 2975, 3272, 3483, 3747 |
| `.listen()` | gui_builder.js:855, 2894 |
| `.updateDisplay()` | gui_builder.js:670, 696, 3022; main.js:432, 444 |
| `.disable()` / `.enable()` | gui_builder.js:3016, 3106; pattern_editor.js:391 |
| `.property` | gui_builder.js:2886, 2892 |
| `.domElement` (`.closest('.controller')`, `.style.display`) | gui_builder.js:616-635 |
| `.domElement.querySelector('.slider')` / `('.fill')` (hue-slider restyle) | pattern_editor.js:181-182 |
| `._name`, `._min`, `._max`, `._step`, `$select` (schema oracle) | control_schema.js:33-41 |

Not used but kept (trivial): `getValue()`, `setValue()`, `reset()`,
`show()`/`hide()`, `options()`, `min()`/`max()`/`step()` (no-op on
non-number, real on number), `load()`, `save()` (used internally by
`listen()`).

## 4. DOM contract

- GUI/folder root: `div.marsin-gui` (root additionally `.root` and
  `.autoPlace`; NOT `.lil-gui` to avoid legacy CSS collisions), containing
  a direct-child `.title` element and a `.children` container with
  controller/folder elements in insertion order. `closed` class mirrors
  `_closed`.
- Controller root: `div.controller.<type>` where `<type>` ∈ `boolean |
  color | string | number | option | function` (the schema oracle's type
  detector), containing `div.name` + `.widget`.
- Number-with-range: `.slider` track containing `.fill` (width set in %,
  knob via `::after`) + `input[type=number]` — keeps pattern_editor's
  `styleAsHueSlider()` working unchanged.
- `_min`/`_max` stay `undefined` for un-ranged numbers (schema parity);
  `_step` is always defined for numbers: explicit, else `(max-min)/1000`
  when ranged, else `0.1` — identical to lil-gui's implicit step.
- Root element stops `pointerdown` propagation: `src/core/interaction.js`
  ignores clicks via `closest('.lil-gui')`, which can't match MarsinGui's
  class; stopping propagation reproduces "GUI clicks never reach the
  raycaster" without touching files outside `modern_gui/`.
