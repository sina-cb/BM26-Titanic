import { create } from 'zustand';

export const useStore = create((set) => ({
  // Model Data
  model: null,
  filePath: null,
  
  // UI State
  cameraPreset: 'front',
  cameraTrigger: 0,
  selectedPixelIds: new Set(),
  showGrid: true,
  showShell: true,
  showLabels: false,
  testPattern: null,

  // Actions
  loadModel: (modelData, filePath = null) => set({ 
    model: modelData, 
    filePath: filePath || useStore.getState().filePath,
    selectedPixelIds: new Set(),
    testPattern: null
  }),

  triggerCamera: (preset) => set(state => ({ 
    cameraPreset: preset, 
    cameraTrigger: state.cameraTrigger + 1 
  })),
  
  toggleGrid: () => set(state => ({ showGrid: !state.showGrid })),
  toggleShell: () => set(state => ({ showShell: !state.showShell })),
  toggleLabels: () => set(state => ({ showLabels: !state.showLabels })),

  selectPixel: (id, multi = false) => set(state => {
    const newSet = new Set(multi ? state.selectedPixelIds : []);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    return { selectedPixelIds: newSet };
  }),

  clearSelection: () => set({ selectedPixelIds: new Set() }),

  setTestPattern: (pattern) => set({ testPattern: pattern }),

  // Basic pixel update (e.g. from properties panel)
  updatePixel: (id, patch) => set(state => {
    if (!state.model) return state;
    const newPixels = state.model.pixels.map(p => 
      p.id === id ? { ...p, ...patch } : p
    );
    return { model: { ...state.model, pixels: newPixels } };
  })
}));
