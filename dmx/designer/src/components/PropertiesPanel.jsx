import React from 'react';
import { useStore } from '../store';

export function PropertiesPanel() {
  const model = useStore(state => state.model);
  const selectedIds = useStore(state => state.selectedPixelIds);
  const updatePixel = useStore(state => state.updatePixel);

  if (!model) {
    return (
      <div className="panel properties-panel">
        <div className="panel-content empty">No model loaded</div>
      </div>
    );
  }

  // Find the selected pixel, if exactly 1 is selected
  const selectedId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null;
  const pixel = selectedId ? model.pixels.find(p => p.id === selectedId) : null;
  const isMulti = selectedIds.size > 1;

  return (
    <div className="panel properties-panel">
      <div className="panel-header">Properties</div>
      <div className="panel-content">
        
        <div className="section">
          <div className="section-title">Fixture</div>
          <div className="prop-row"><span>ID:</span> <strong>{model.id}</strong></div>
          <div className="prop-row"><span>Type:</span> <span>{model.fixture_type}</span></div>
          <div className="prop-row"><span>Mode:</span> <span>{model.channel_mode}ch</span></div>
          <div className="prop-row"><span>Pixels:</span> <span>{model.pixels?.length || 0}</span></div>
        </div>

        {isMulti && (
          <div className="section">
            <div className="section-title">Selection</div>
            <div className="prop-row"><span>Selected:</span> <strong>{selectedIds.size} pixels</strong></div>
            <p className="hint">Multi-edit coming soon.</p>
          </div>
        )}

        {pixel && (
          <div className="section">
            <div className="section-title">Selected Pixel</div>
            <div className="prop-row">
              <label>ID:</label>
              <input 
                type="text" 
                value={pixel.id} 
                onChange={(e) => updatePixel(pixel.id, { id: e.target.value })}
              />
            </div>
            <div className="prop-row">
              <label>Type:</label>
              <select 
                value={pixel.type}
                onChange={(e) => updatePixel(pixel.id, { type: e.target.value })}
              >
                <option value="rgb">rgb</option>
                <option value="rgbwau">rgbwau</option>
                <option value="single">single</option>
                <option value="warm">warm</option>
              </select>
            </div>
            
            <div className="section-subtitle">Size / Shape</div>
            {Array.isArray(pixel.size) ? (
              <div className="dot-editor">
                <input type="number" value={pixel.size[0]} onChange={e => handleSizeChange(pixel, 0, e.target.value)} title="Width" />
                <input type="number" value={pixel.size[1]} onChange={e => handleSizeChange(pixel, 1, e.target.value)} title="Height" />
                <input type="number" value={pixel.size[2]} onChange={e => handleSizeChange(pixel, 2, e.target.value)} title="Depth" />
                <button className="btn" style={{gridColumn: 'span 3', marginTop:'4px'}} onClick={() => updatePixel(pixel.id, { size: 10 })}>Change to Sphere</button>
              </div>
            ) : (
              <div className="prop-row">
                <label>Radius:</label>
                <input 
                  type="number" 
                  value={pixel.size !== undefined ? pixel.size : 3} 
                  onChange={e => updatePixel(pixel.id, { size: parseFloat(e.target.value) || 3 })} 
                />
                <button className="btn" style={{marginLeft:'8px'}} onClick={() => updatePixel(pixel.id, { size: [10, 10, 10] })}>Change to Box</button>
              </div>
            )}

            <div className="section-subtitle">Dots ({pixel.dots.length})</div>
            {pixel.dots.length === 1 ? (
              <div className="dot-editor">
                <input type="number" value={pixel.dots[0][0]} onChange={e => handlePosChange(pixel, 0, 0, e.target.value)} title="X" />
                <input type="number" value={pixel.dots[0][1]} onChange={e => handlePosChange(pixel, 0, 1, e.target.value)} title="Y" />
                <input type="number" value={pixel.dots[0][2]} onChange={e => handlePosChange(pixel, 0, 2, e.target.value)} title="Z" />
              </div>
            ) : (
              <div className="hint">{pixel.dots.length} dots (multi-dot pixel)</div>
            )}

            <div className="section-subtitle">Channels</div>
            <div className="channel-list">
              {Object.entries(pixel.channels).map(([key, val]) => (
                <div key={key} className="prop-row">
                  <label>{key}:</label>
                  <input 
                    type="number" 
                    value={val} 
                    min={1} 
                    max={512}
                    onChange={(e) => handleChannelChange(pixel, key, parseInt(e.target.value, 10))}
                  />
                </div>
              ))}
            </div>

            {pixel.type === 'single' && (
              <div className="prop-row">
                <label>Color Hint:</label>
                <input 
                  type="color" 
                  value={pixel.color_hint || '#ffffff'} 
                  onChange={(e) => updatePixel(pixel.id, { color_hint: e.target.value })}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  function handlePosChange(pixel, dotIdx, axisIdx, valStr) {
    const val = parseFloat(valStr) || 0;
    const newDots = [...pixel.dots];
    newDots[dotIdx] = [...newDots[dotIdx]];
    newDots[dotIdx][axisIdx] = val;
    updatePixel(pixel.id, { dots: newDots });
  }

  function handleChannelChange(pixel, key, val) {
    if (isNaN(val)) return;
    updatePixel(pixel.id, {
      channels: { ...pixel.channels, [key]: val }
    });
  }

  function handleSizeChange(pixel, axisIdx, valStr) {
    const val = parseFloat(valStr) || 0;
    const newSize = [...pixel.size];
    newSize[axisIdx] = val;
    updatePixel(pixel.id, { size: newSize });
  }
}
