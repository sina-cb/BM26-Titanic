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
      { keys: ['M'], desc: 'Toggle the 2D Pixel Map window' },
      { keys: ['Ctrl', 'Shift', 'W'], desc: 'Open this shortcuts help' },
    ],
  },
  {
    // 2D Pixel Map multiview — these fire only while a vis pane has focus; they
    // are stopPropagation'd so the 3D scene shortcuts never collide with them.
    category: '2D Vis (focused)',
    items: [
      { keys: ['\\'], desc: 'Split pane vertically (side-by-side)' },
      { keys: ['-'], desc: 'Split pane horizontally (stacked)' },
      { keys: ['X'], desc: 'Close focused pane' },
      { keys: ['Z'], desc: 'Zoom (maximize) focused pane, toggle' },
      { keys: ['Tab'], desc: 'Cycle pane focus (Shift = reverse)' },
      { keys: ['Alt', '←↑↓→'], desc: 'Directional pane focus' },
      { keys: ['[', ']'], desc: 'Previous / next view in the focused pane' },
      { keys: ['1', '–', '9'], desc: 'Bind the Nth view to the focused pane' },
      { keys: ['F'], desc: 'Fit (reset pan/zoom) in the focused pane' },
      { keys: ['Ctrl', 'Alt', '←→↑↓'], desc: 'Grow / shrink the focused pane' },
      { keys: ['Q', 'E'], desc: 'EDIT: rotate selection (Alt = 1°)' },
      { keys: ['Arrows'], desc: 'EDIT: nudge selection (Shift = 8u)' },
    ],
  },
];
