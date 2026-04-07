import React from 'react';
import { useStore } from './store';
import { Toolbar } from './components/Toolbar';
import { Viewport } from './components/Viewport';
import { PropertiesPanel } from './components/PropertiesPanel';
import { PixelList } from './components/PixelList';
import { DmxTestPanel } from './components/DmxTestPanel';
import './App.css';

function App() {
  const model = useStore(state => state.model);

  return (
    <div className="app-container">
      <Toolbar />
      <div className="main-workspace">
        <div className="viewport-container">
          <Viewport />
        </div>
        <div className="right-sidebar">
          <PropertiesPanel />
          <DmxTestPanel />
        </div>
      </div>
      {model && (
        <div className="bottom-panel">
          <PixelList />
        </div>
      )}
    </div>
  );
}

export default App;
