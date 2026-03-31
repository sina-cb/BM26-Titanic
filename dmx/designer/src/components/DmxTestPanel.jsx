import React from 'react';
import { useStore } from '../store';

const PATTERNS = [
  { id: 'red', label: 'Static Red', bg: '#ff3030' },
  { id: 'green', label: 'Static Green', bg: '#30ff30', text: '#000' },
  { id: 'blue', label: 'Static Blue', bg: '#4040ff' },
  { id: 'white', label: 'Static White', bg: '#ffffff', text: '#000' },
  { id: 'amber', label: 'Static Amber', bg: '#ffb000', text: '#000' },
  { id: 'violet', label: 'Static Violet / UV', bg: '#8a2be2' },
  { id: 'all_on', label: 'All On', bg: '#dddddd', text: '#000' },
];

export function DmxTestPanel() {
  const model = useStore(state => state.model);
  const testPattern = useStore(state => state.testPattern);
  const setTestPattern = useStore(state => state.setTestPattern);

  if (!model) return null;

  return (
    <div className="test-panel">
      <div className="panel-header">DMX Test (Visual Stub)</div>
      <div className="test-buttons">
        <button 
          className={`btn ${!testPattern ? 'active' : ''}`}
          onClick={() => setTestPattern(null)}
        >
          Idle
        </button>
        {PATTERNS.map(p => (
          <button
            key={p.id}
            className={`btn ${testPattern === p.id ? 'active pulse' : ''}`}
            style={testPattern === p.id ? { background: p.bg, color: p.text || '#fff' } : {}}
            onClick={() => setTestPattern(p.id)}
          >
            {p.label}
          </button>
        ))}
        <button 
          className={`btn ${testPattern === 'blackout' ? 'active' : ''}`}
          onClick={() => setTestPattern('blackout')}
        >
          Blackout
        </button>
      </div>
      <div className="hint text-center" style={{marginTop: '8px'}}>
        (Art-Net transmission coming in next phase)
      </div>
    </div>
  );
}
