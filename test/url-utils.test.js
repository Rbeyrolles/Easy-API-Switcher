import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanEndpoint, endpointsEqual, isBindableEndpoint } from '../url-utils.js';

test('accepts normal HTTP(S) Custom endpoints', () => {
    assert.equal(isBindableEndpoint('https://api.example.com/v1'), true);
    assert.equal(isBindableEndpoint('http://localhost:1234/v1'), true);
});

test('rejects non-HTTP URLs and credentials in visible labels', () => {
    assert.equal(isBindableEndpoint('ftp://api.example.com/v1'), false);
    assert.equal(isBindableEndpoint('https://user:pass@example.com/v1'), false);
    assert.equal(isBindableEndpoint('not a url'), false);
    assert.equal(isBindableEndpoint(''), false);
});

test('trims endpoints and compares URL-equivalent host roots', () => {
    assert.equal(cleanEndpoint('  https://api.example.com/v1  '), 'https://api.example.com/v1');
    assert.equal(endpointsEqual('https://api.example.com', 'https://api.example.com/'), true);
    assert.equal(endpointsEqual('https://api.example.com/v1', 'https://api.example.com/v2'), false);
});
