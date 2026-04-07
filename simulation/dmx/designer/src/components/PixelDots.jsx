import React from 'react';
import { useStore } from '../store';
import { getDotColor } from '../lib/pixelColors';

export function PixelDots() {
  const model = useStore(state => state.model);
  const testPattern = useStore(state => state.testPattern);
  const selectedIds = useStore(state => state.selectedPixelIds);
  const selectPixel = useStore(state => state.selectPixel);

  if (!model) return null;

  return (
    <group>
      {model.pixels.map(pixel => {
        const isSelected = selectedIds.has(pixel.id);
        let color = getDotColor(pixel, testPattern);
        
        if (isSelected && !testPattern) {
          color = '#00ffcc';
        }

        const size = pixel.size;
        const isBox = Array.isArray(size) && size.length === 3;
        const radius = typeof size === 'number' ? size : 3;
        
        const scale = isSelected ? 1.2 : 1.0;

        return (
          <group key={pixel.id}>
            {pixel.dots.map((pos, i) => (
              <mesh 
                key={`${pixel.id}-${i}`}
                position={[pos[0], pos[1], pos[2]]}
                scale={[scale, scale, scale]}
                onClick={(e) => {
                  e.stopPropagation();
                  selectPixel(pixel.id, e.shiftKey || e.ctrlKey || e.metaKey);
                }}
                onPointerMissed={(e) => {
                  if (e.type === 'click') {
                    useStore.getState().clearSelection();
                  }
                }}
              >
                {isBox ? (
                  <boxGeometry args={size} />
                ) : (
                  <sphereGeometry args={[radius, 16, 16]} />
                )}
                <meshStandardMaterial 
                  color={color} 
                  toneMapped={false}
                  emissive={color}
                  emissiveIntensity={testPattern ? 2.5 : 0.8}
                />
                
                {isSelected && (
                  <meshBasicMaterial 
                    color="#ffffff" 
                    wireframe 
                    transparent 
                    opacity={0.5} 
                    depthTest={false} 
                  />
                )}
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}
