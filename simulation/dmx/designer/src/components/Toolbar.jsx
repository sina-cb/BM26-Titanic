import React from 'react';
import { useStore } from '../store';
import { loadModelFromYaml, serializeModelToYaml } from '../lib/modelLoader';

export function Toolbar() {
  const model = useStore(state => state.model);
  const filePath = useStore(state => state.filePath);
  const triggerCamera = useStore(state => state.triggerCamera);
  const showGrid = useStore(state => state.showGrid);
  const toggleGrid = useStore(state => state.toggleGrid);
  const showShell = useStore(state => state.showShell);
  const toggleShell = useStore(state => state.toggleShell);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // In Electron, File objects have a path property
    const path = file.path; 

    const reader = new FileReader();
    reader.onload = (event) => {
      const parsed = loadModelFromYaml(event.target.result);
      if (parsed) {
        useStore.getState().loadModel(parsed, path);
      } else {
        alert("Failed to parse YAML model.");
      }
    };
    reader.readAsText(file);
    e.target.value = null; // reset input
  };

  const handleReload = () => {
    if (!filePath) return;
    try {
      if (window.require) {
        const fs = window.require('fs');
        const yamlStr = fs.readFileSync(filePath, 'utf8');
        const parsed = loadModelFromYaml(yamlStr);
        if (parsed) {
          useStore.getState().loadModel(parsed, filePath);
        }
      }
    } catch (err) {
      alert("Failed to reload file from disk: " + err.message);
    }
  };

  const handleSave = () => {
    if (!model) return;
    const yamlStr = serializeModelToYaml(model);
    const blob = new Blob([yamlStr], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${model.id || 'model'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <label className="btn">
          Load YAML
          <input type="file" accept=".yaml,.yml" hidden onChange={handleFileUpload} />
        </label>
        {filePath && (
          <button className="btn" onClick={handleReload} title="Reload from disk">Reload</button>
        )}
        <button className="btn" onClick={handleSave} disabled={!model}>Save YAML</button>
      </div>

      <div className="toolbar-group">
        <button className="btn" onClick={() => triggerCamera('front')}>Front</button>
        <button className="btn" onClick={() => triggerCamera('top')}>Top</button>
        <button className="btn" onClick={() => triggerCamera('side')}>Side</button>
        <button className="btn" onClick={() => triggerCamera('iso')}>Iso</button>
      </div>

      <div className="toolbar-group">
        <button className={`btn ${showGrid ? 'active' : ''}`} onClick={toggleGrid}>Grid</button>
        <button className={`btn ${showShell ? 'active' : ''}`} onClick={toggleShell}>Shell</button>
      </div>
      
      <div className="toolbar-title">
        {model ? `${model.name} (${model.fixture_type})` : 'DMX Fixture Designer'}
      </div>
    </div>
  );
}
