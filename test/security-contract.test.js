import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const productionFiles = [
    'index.js',
    'manager.js',
    'binding-service.js',
    'secret-client.js',
    'endpoint-store.js',
    'compatibility.js',
];

test('production code never uses key-exposure endpoints or browser persistence', async () => {
    for (const file of productionFiles) {
        const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /\/api\/secrets\/(?:find|view)/, `${file} must not request saved key values`);
        assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB|extensionSettings)\b/, `${file} must not persist key material client-side`);
        assert.doesNotMatch(source, /allowKeysExposure/, `${file} must not require key exposure`);
    }
});

test('Connection Profile programmatic connects are explicitly excluded', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /event\.isTrusted\s*&&\s*isCustomChatCompletion\(\)/);
    assert.doesNotMatch(source, /SECRET_ROTATED[^\n]+(?:on|addEventListener)/);
});

test('saved masked values are discarded by the Secret client', async () => {
    const source = await readFile(new URL('../secret-client.js', import.meta.url), 'utf8');
    assert.match(source, /\.map\(secret\s*=>\s*\(\{[\s\S]*?id:[\s\S]*?label:[\s\S]*?active:/);
    assert.doesNotMatch(source, /value:\s*secret\.value/);
});
