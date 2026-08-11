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

test('production code avoids direct key lookup endpoints and browser persistence', async () => {
    for (const file of productionFiles) {
        const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /\/api\/secrets\/(?:find|view)/, `${file} must not bypass the normal Secret read policy`);
        assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB|extensionSettings)\b/, `${file} must not persist key material client-side`);
    }
});

test('Connection Profile programmatic connects are explicitly excluded', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /event\.isTrusted\s*&&\s*isCustomChatCompletion\(\)/);
    assert.doesNotMatch(source, /SECRET_ROTATED[^\n]+(?:on|addEventListener)/);
});

test('editing a different Key uses native new-Secret semantics', async () => {
    const source = await readFile(new URL('../manager.js', import.meta.url), 'utf8');
    assert.match(source, /hasNewKey[\s\S]*?this\.binding\.add\(\{ endpoint: endpoint\.value, value: key\.value \}\)/);
    assert.match(source, /#edit\(id, \{ allowKeyChange: false \}\)/);
});
