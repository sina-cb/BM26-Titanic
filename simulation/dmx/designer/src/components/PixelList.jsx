import React, { useMemo } from 'react';
import { useStore } from '../store';
import { getDotColor } from '../lib/pixelColors';

export function PixelList() {
  const model = useStore(state => state.model);
  const selectedIds = useStore(state => state.selectedPixelIds);
  const selectPixel = useStore(state => state.selectPixel);
  const testPattern = useStore(state => state.testPattern);

  if (!model) return null;

  return (
    <div className="panel pixel-list-panel">
      <div className="panel-header">Pixel List ({model.pixels.length})</div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Dots</th>
              <th>Channels</th>
              <th>Preview</th>
            </tr>
          </thead>
          <tbody>
            {model.pixels.map(pixel => {
              const isSelected = selectedIds.has(pixel.id);
              const previewHex = getDotColor(pixel, testPattern);
              const chanStr = Object.entries(pixel.channels)
                                    .map(([k, v]) => `${k.charAt(0).toUpperCase()}:${v}`)
                                    .join(' ');
              
              return (
                <tr 
                  key={pixel.id} 
                  className={isSelected ? 'selected' : ''}
                  onClick={(e) => selectPixel(pixel.id, e.shiftKey || e.ctrlKey || e.metaKey)}
                >
                  <td>{pixel.id}</td>
                  <td>{pixel.type}</td>
                  <td>{pixel.dots.length}</td>
                  <td className="mono">{chanStr}</td>
                  <td>
                    <div className="color-dot" style={{ backgroundColor: previewHex }}></div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
