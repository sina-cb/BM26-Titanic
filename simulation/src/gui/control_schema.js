/**
 * control_schema.js — UI-agnostic serialization of the live control tree.
 *
 * Serializes whatever GUI is currently mounted into a plain JSON tree
 * (folders, controls, types, ranges, options). Originally the parity
 * oracle for the UI rehaul (diffing the old lil-gui tree against MarsinGui,
 * tasks 015/018); kept as a general control-tree snapshot tool for
 * regression checks.
 *
 * Control type is read from the controller's DOM classes (`controller
 * boolean`, `controller number`, …) — the class contract MarsinGui shares
 * with the lil-gui API — because constructor names are mangled in minified
 * builds.
 *
 * Registered on import as `window.__captureControlSchema()` — evaluated
 * lazily so it works whenever `window.guiInstance` exists.
 * Capture from outside via agent_tools/capture_control_schema.cjs.
 */

const CONTROL_TYPE_CLASSES = ['boolean', 'color', 'string', 'number', 'option', 'function'];

function controllerType(controller) {
  const classes = controller.domElement?.classList;
  if (!classes) return 'unknown';
  for (const t of CONTROL_TYPE_CLASSES) {
    if (classes.contains(t)) return t;
  }
  return 'unknown';
}

function serializeController(controller) {
  const entry = {
    kind: 'control',
    name: controller._name ?? null,
    type: controllerType(controller),
  };
  if (controller._min !== undefined && controller._min !== -Infinity) entry.min = controller._min;
  if (controller._max !== undefined && controller._max !== Infinity) entry.max = controller._max;
  if (controller._step !== undefined && controller._step !== null) entry.step = controller._step;
  if (entry.type === 'option' && controller.$select) {
    entry.options = [...controller.$select.options].map((o) => o.textContent);
  }
  return entry;
}

export function serializeControlTree(gui) {
  if (!gui) {
    throw new Error('serializeControlTree: no GUI instance provided');
  }
  const node = {
    kind: 'folder',
    title: gui._title ?? gui.$title?.textContent ?? null,
    children: [],
  };
  for (const child of gui.children) {
    if (child.children !== undefined && child.folders !== undefined) {
      node.children.push(serializeControlTree(child));
    } else {
      node.children.push(serializeController(child));
    }
  }
  return node;
}

export function countControls(tree) {
  if (tree.kind === 'control') return 1;
  return tree.children.reduce((sum, c) => sum + countControls(c), 0);
}

window.__captureControlSchema = () => {
  const tree = serializeControlTree(window.guiInstance);
  return { capturedAt: new Date().toISOString(), controlCount: countControls(tree), tree };
};
