/**
 * shortcuts.js — Single source of truth for every keyboard / mouse shortcut.
 *
 * The help panel (help_panel.js) and the bottom-right hint both render from
 * this list, and the bindings themselves live in interaction.js. Keeping the
 * catalogue here means the on-screen help can never drift from reality as
 * long as new bindings are added in both places.
 *
 * Pure data — no DOM, no imports — so it stays trivially testable.
 */

export const SHORTCUT_GROUPS = [
  {
    category: 'Camera',
    items: [
      { keys: ['Left-drag'], desc: 'Orbit' },
      { keys: ['Scroll'], desc: 'Zoom' },
      { keys: ['Right-drag'], desc: 'Pan' },
    ],
  },
  {
    category: 'Transform',
    items: [
      { keys: ['T'], desc: 'Translate (press again to toggle world/local)' },
      { keys: ['R'], desc: 'Rotate (press again to toggle world/local)' },
      { keys: ['S'], desc: 'Scale' },
      { keys: ['Q'], desc: 'Toggle world / local space' },
    ],
  },
  {
    category: 'Fixtures',
    items: [
      { keys: ['D'], desc: 'Duplicate selected' },
      { keys: ['Del'], desc: 'Delete selected' },
      { keys: ['P'], desc: 'Place on surface (snap mode)' },
      { keys: ['Shift', 'Click'], desc: 'Multi-select' },
      { keys: ['Esc'], desc: 'Deselect / exit current mode' },
    ],
  },
  {
    category: 'Edit',
    items: [
      { keys: ['Ctrl', 'Z'], desc: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], desc: 'Redo' },
    ],
  },
  {
    category: 'Panels & View',
    items: [
      { keys: ['H'], desc: 'Cycle UI: show all → hide editing chrome → hide all' },
      { keys: ['B'], desc: 'Toggle the Lighting Controls drawer' },
      { keys: ['Ctrl', 'Shift', 'W'], desc: 'Open this shortcuts help' },
    ],
  },
];
