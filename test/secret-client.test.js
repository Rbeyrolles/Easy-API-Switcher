import test from 'node:test';
import assert from 'node:assert/strict';
import { SecretClient } from '../secret-client.js';

function response(body, ok = true) {
    return {
        ok,
        status: ok ? 200 : 500,
        json: async () => body,
    };
}

test('list keeps the native mask when key exposure is disabled', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });

    globalThis.fetch = async path => {
        if (path === '/api/secrets/settings') return response({ allowKeysExposure: false });
        if (path === '/api/secrets/read') {
            return response({
                api_key_custom: [{ id: 'secret-a', label: 'https://example.com/v1', active: true, value: '********key' }],
            });
        }
        throw new Error(`Unexpected path: ${path}`);
    };

    const client = new SecretClient(() => ({}));
    assert.deepEqual(await client.list(), [{
        id: 'secret-a',
        label: 'https://example.com/v1',
        active: true,
        value: '********key',
        exposed: false,
    }]);
});

test('list returns plaintext only when SillyTavern reports exposure enabled', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });

    globalThis.fetch = async path => {
        if (path === '/api/secrets/settings') return response({ allowKeysExposure: true });
        if (path === '/api/secrets/read') {
            return response({
                api_key_custom: [{ id: 'secret-b', label: 'https://example.org/v1', active: false, value: 'sk-plaintext' }],
            });
        }
        throw new Error(`Unexpected path: ${path}`);
    };

    const client = new SecretClient(() => ({}));
    assert.deepEqual(await client.list(), [{
        id: 'secret-b',
        label: 'https://example.org/v1',
        active: false,
        value: 'sk-plaintext',
        exposed: true,
    }]);
});

test('list fails closed when exposure settings cannot be read', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });

    globalThis.fetch = async path => {
        if (path === '/api/secrets/settings') return response({}, false);
        if (path === '/api/secrets/read') {
            return response({
                api_key_custom: [{ id: 'secret-c', label: '', active: true, value: 'unexpected-value' }],
            });
        }
        throw new Error(`Unexpected path: ${path}`);
    };

    const client = new SecretClient(() => ({}));
    assert.deepEqual(await client.list(), [{
        id: 'secret-c',
        label: '',
        active: true,
        value: '**********',
        exposed: false,
    }]);
});
