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
  const t0 = performance.now();
  try {
    // Detect if fixture structure changed (count or types)
    const oldParCount = params.parLights?.length || 0;
    const newParCount = snapshot.parLights?.length || 0;
    const parStructureChanged = oldParCount !== newParCount ||
      (snapshot.parLights || []).some((cfg, i) => {
        const old = params.parLights?.[i];
        if (!old) return true;
        return (cfg.type || cfg.fixtureType || 'UkingPar') !== (old.type || old.fixtureType || 'UkingPar');
      });

    // Detect which subsystems actually changed
    const dmxChanged = JSON.stringify(params.dmxFixtures) !== JSON.stringify(snapshot.dmxFixtures || []);
    const tracesChanged = JSON.stringify(params.traces) !== JSON.stringify(snapshot.traces || []);
    const strandsChanged = JSON.stringify(params.ledStrands) !== JSON.stringify(snapshot.ledStrands || []);
    const icebergsChanged = JSON.stringify(params.icebergs) !== JSON.stringify(snapshot.icebergs || []);

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

    const t1 = performance.now();

    if (parStructureChanged) {
      if (window.rebuildParLights) window.rebuildParLights();
    } else {
      // Fast path — just sync positions/properties without recreating lights
      if (window.parFixtures) {
        for (let i = 0; i < window.parFixtures.length; i++) {
          const f = window.parFixtures[i];
          if (f) {
            f.config = params.parLights[i];
            f.syncFromConfig();
          }
        }
      }
    }

    const t2 = performance.now();

    // Only rebuild subsystems that actually changed
    if (dmxChanged && window.rebuildDmxFixtures) window.rebuildDmxFixtures();
    if (tracesChanged && window.rebuildTraceObjects) window.rebuildTraceObjects();
    if (strandsChanged && window.rebuildLedStrands) window.rebuildLedStrands();
    if (icebergsChanged && window.rebuildIcebergs) window.rebuildIcebergs();

    const t3 = performance.now();

    if (parStructureChanged) {
      if (window.renderParGUI) window.renderParGUI();
    }
    if (dmxChanged && window.renderDmxGUI) window.renderDmxGUI();
    if (window.renderGeneratorGUI) window.renderGeneratorGUI();

    const t4 = performance.now();

    if (window.guiInstance) {
      window.guiInstance.controllersRecursive().forEach(c => {
        try { c.updateDisplay(); } catch (_) {}
      });
    }

    const t5 = performance.now();

    if (window.applyAllHandlers) window.applyAllHandlers();
    if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('undo');
    if (window.debounceAutoSave) window.debounceAutoSave();

    const t6 = performance.now();
    console.log(`[undo] total=${(t6-t0).toFixed(0)}ms | data=${(t1-t0).toFixed(0)} fixtures=${(t2-t1).toFixed(0)} subsys=${(t3-t2).toFixed(0)} gui=${(t4-t3).toFixed(0)} display=${(t5-t4).toFixed(0)} handlers=${(t6-t5).toFixed(0)} parStruct=${parStructureChanged}`);
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
