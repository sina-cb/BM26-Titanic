import React from 'react';
import { useStore } from '../store';

export function FixtureShell() {
  const model = useStore(state => state.model);
  const showShell = useStore(state => state.showShell);

  if (!model || !showShell || !model.shell) return null;

  const { type, dimensions, color, offset } = model.shell;
  const pos = offset || [0, 0, 0];

  const rotation = type === 'cylinder' ? [Math.PI / 2, 0, 0] : [0, 0, 0];

  return (
    <mesh position={pos} rotation={rotation}>
      {type === 'box' && <boxGeometry args={dimensions} />}
      {type === 'cylinder' && (
        <cylinderGeometry 
           args={[dimensions[0]/2, dimensions[1]/2, dimensions[2], 32]} 
        />
      )}
      <meshStandardMaterial 
        color={color || '#111111'} 
        roughness={0.7}
      />
    </mesh>
  );
}
