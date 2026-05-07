import test from 'node:test';
import assert from 'node:assert/strict';

for (const fixtureType of ['TEFogMachine', 'ChauvetHaze4D']) {
    test(`${fixtureType} exposes correct fixtureDef to prevent recreation`, async () => {
        const mockScene = { add: () => {}, remove: () => {} };
        const mockInteractiveObjects = [];

        const { FogMachine } = await import('../src/fixtures/fog_machine.js');

        const config = { fixtureType, x: 0, y: 0, z: 0 };
        const fogger = new FogMachine(config, 0, mockScene, mockInteractiveObjects, 10);

        // Validate fixture def exists so rebuildParLights doesn't trash it
        assert.ok(fogger.fixtureDef, 'FogMachine should expose fixtureDef');
        assert.equal(fogger.fixtureDef.fixtureType, fixtureType, 'fixtureType should match the fixture config');

        // Validate hitbox
        assert.ok(fogger.hitbox, 'FogMachine should have a hitbox for UI selection');
        assert.ok(mockInteractiveObjects.includes(fogger.hitbox), 'Hitbox should be registered in interactive objects');

        // Test cleanup
        fogger.destroy();
        assert.equal(mockInteractiveObjects.length, 0, 'Hitbox should be removed on destroy');
    });
}
