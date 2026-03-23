import React, { useRef, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { useStore } from '../store';
import { PixelDots } from './PixelDots';
import { FixtureShell } from './FixtureShell';

function SceneSetup() {
  const showGrid = useStore(state => state.showGrid);
  const cameraPreset = useStore(state => state.cameraPreset);
  const cameraTrigger = useStore(state => state.cameraTrigger);
  const controlsRef = useRef();
  const { camera } = useThree();

  useEffect(() => {
    if (!controlsRef.current || cameraTrigger === 0) return;
    const target = controlsRef.current.target;
    target.set(0, 0, 0);

    const dist = 600;
    switch(cameraPreset) {
      case 'front': 
        camera.position.set(0, 0, dist); 
        camera.up.set(0, 1, 0);
        break;
      case 'top': 
        camera.position.set(0, dist, 0); 
        camera.up.set(0, 0, -1);
        break;
      case 'side': 
        camera.position.set(dist, 0, 0); 
        camera.up.set(0, 1, 0);
        break;
      case 'iso': 
        camera.position.set(dist * 0.7, dist * 0.7, dist * 0.7); 
        camera.up.set(0, 1, 0);
        break;
    }

    camera.lookAt(0, 0, 0);
    controlsRef.current.update();
  }, [cameraTrigger, cameraPreset, camera]);

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 600]} fov={50} />
      <OrbitControls ref={controlsRef} makeDefault />
      
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 10]} intensity={1} />

      {showGrid && (
        <Grid 
          infiniteGrid 
          fadeDistance={2000} 
          sectionColor="#333333" 
          cellColor="#222222" 
        />
      )}
      
      <group>
        <PixelDots />
        <FixtureShell />
        
        <EffectComposer disableNormalPass>
          <Bloom luminanceThreshold={0.1} mipmapBlur intensity={1.2} />
        </EffectComposer>

        <GizmoHelper alignment="bottom-right" margin={[40, 40]}>
          <GizmoViewport axisColors={['#ff3653', '#8adb00', '#2c8fff']} labelColor="white" />
        </GizmoHelper>
      </group>
    </>
  );
}

export function Viewport() {
  return (
    <div className="viewport-container" style={{ width: '100%', height: '100%', background: '#0a0a0a' }}>
      <Canvas>
        <SceneSetup />
      </Canvas>
    </div>
  );
}
