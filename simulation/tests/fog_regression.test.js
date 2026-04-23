import test from 'node:test';
import assert from 'node:assert/strict';

// Test 1: FogMachine lifecycle properties
test('FogMachine exposes correct fixtureDef to prevent recreation', async () => {
    // We mock THREE and interactiveObjects to instantiate FogMachine
    global.THREE = {
        Group: class { add() {} position = { set() {} }; rotation = { setFromVector3() {} }; },
        BoxGeometry: class { dispose() {} },
        CylinderGeometry: class { translate() {}; rotateX() {}; dispose() {}; },
        MeshBasicMaterial: class { dispose() {} },
        Mesh: class {},
        MathUtils: { degToRad: () => 0 },
        Vector3: class {},
        AdditiveBlending: 1
    };
    
    // We mock scene and interactiveObjects
    const mockScene = { add: () => {}, remove: () => {} };
    const mockInteractiveObjects = [];
    
    const { FogMachine } = await import('../src/fixtures/fog_machine.js');
    
    const fogger = new FogMachine({ x: 0, y: 0, z: 0 }, 0, mockScene, mockInteractiveObjects, 10);
    
    // Validate fixture def exists so rebuildParLights doesn't trash it
    assert.ok(fogger.fixtureDef, 'FogMachine should expose fixtureDef');
    assert.equal(fogger.fixtureDef.fixtureType, 'FogMachine', 'fixtureType should be FogMachine');
    
    // Validate hitbox
    assert.ok(fogger.hitbox, 'FogMachine should have a hitbox for UI selection');
    assert.ok(mockInteractiveObjects.includes(fogger.hitbox), 'Hitbox should be registered in interactive objects');
    
    // Test cleanup
    fogger.destroy();
    assert.equal(mockInteractiveObjects.length, 0, 'Hitbox should be removed on destroy');
});
