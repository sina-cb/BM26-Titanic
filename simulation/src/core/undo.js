/**
 * undo.js — Undo/redo snapshot system.
 * Captures and restores the full parameter state.
 */
import { params, undoStack, redoStack, MAX_UNDO } from "./state.js";

export function captureSnapshot() {
  const snapshot = {};
  for (const key of Object.keys(params)) {
    if (key === 'parLights') {
      snapshot.parLights = JSON.parse(JSON.stringify(params.parLights));
    } else if (key === 'dmxFixtures') {
      snapshot.dmxFixtures = JSON.parse(JSON.stringify(params.dmxFixtures));
    } else if (key === 'traces') {
      snapshot.traces = JSON.parse(JSON.stringify(params.traces));
    } else if (key === 'ledStrands') {
      snapshot.ledStrands = JSON.parse(JSON.stringify(params.ledStrands));
    } else if (key === 'icebergs') {
      snapshot.icebergs = JSON.parse(JSON.stringify(params.icebergs));
    } else {
      snapshot[key] = params[key];
    }
  }
  return snapshot;
}

export function pushUndo() {
  undoStack.push(captureSnapshot());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

export function applySnapshot(snapshot) {
  if (window._setGuiRebuilding) window._setGuiRebuilding(true);
  try {
    for (const key of Object.keys(snapshot)) {
      if (key === 'parLights') {
        params.parLights = JSON.parse(JSON.stringify(snapshot.parLights));
      } else if (key === 'dmxFixtures') {
        params.dmxFixtures = JSON.parse(JSON.stringify(snapshot.dmxFixtures || []));
      } else if (key === 'traces') {
        params.traces = JSON.parse(JSON.stringify(snapshot.traces || []));
      } else if (key === 'ledStrands') {
        params.ledStrands = JSON.parse(JSON.stringify(snapshot.ledStrands || []));
      } else if (key === 'icebergs') {
        params.icebergs = JSON.parse(JSON.stringify(snapshot.icebergs || []));
      } else {
        params[key] = snapshot[key];
      }
    }
    if (window.rebuildParLights) window.rebuildParLights();
    if (window.rebuildDmxFixtures) window.rebuildDmxFixtures();
    if (window.rebuildTraceObjects) window.rebuildTraceObjects();
    if (window.rebuildLedStrands) window.rebuildLedStrands();
    if (window.rebuildIcebergs) window.rebuildIcebergs();
    if (window.renderParGUI) window.renderParGUI();
    if (window.renderDmxGUI) window.renderDmxGUI();
    if (window.renderGeneratorGUI) window.renderGeneratorGUI();
    if (window.guiInstance) {
      window.guiInstance.controllersRecursive().forEach(c => {
        try { c.updateDisplay(); } catch (_) {}
      });
    }
    if (window.applyAllHandlers) window.applyAllHandlers();
    if (window.debounceAutoSave) window.debounceAutoSave();
  } finally {
    if (window._setGuiRebuilding) window._setGuiRebuilding(false);
  }
}

export function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(captureSnapshot());
  applySnapshot(undoStack.pop());
}

export function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(captureSnapshot());
  applySnapshot(redoStack.pop());
}
