import test from 'node:test';
import assert from 'node:assert/strict';

import { BindingService, BindingTransactionError } from '../binding-service.js';

function fixture({ endpoint = 'https://a.example/v1', secrets = [{ id: 'a', label: 'https://a.example/v1', active: true }] } = {}) {
    const state = structuredClone(secrets);
    const calls = [];
    const endpoints = {
        value: endpoint,
        current() { return this.value; },
        async set(value) { calls.push(['endpoint', value]); this.value = value; },
    };
    const secretApi = {
        async list() { return structuredClone(state); },
        async create(value, label) {
            calls.push(['create', value, label]);
            state.forEach(secret => { secret.active = false; });
            state.push({ id: 'new', label, active: true });
            return 'new';
        },
        async rename(id, label) {
            calls.push(['rename', id, label]);
            const secret = state.find(item => item.id === id);
            if (!secret) throw new Error('missing');
            secret.label = label;
        },
        async rotate(id) {
            calls.push(['rotate', id]);
            const secret = state.find(item => item.id === id);
            if (!secret) throw new Error('missing');
            state.forEach(item => { item.active = item.id === id; });
        },
        async delete(id) {
            calls.push(['delete', id]);
            const index = state.findIndex(item => item.id === id);
            if (index >= 0) state.splice(index, 1);
            if (state.length && !state.some(item => item.active)) state[0].active = true;
        },
    };
    return { binding: new BindingService({ secrets: secretApi, endpoints }), secretApi, endpoints, state, calls };
}

test('case A: unchanged URL and unchanged key is a no-op', async () => {
    const f = fixture();
    const result = await f.binding.commitDirect({
        endpoint: 'https://a.example/v1',
        previousEndpoint: 'https://a.example/v1',
        endpointChanged: false,
        hasNewSecret: false,
    });
    assert.equal(result.kind, 'unchanged');
    assert.deepEqual(f.calls, []);
});

test('case B: a new key creates a second active Secret labeled with the unchanged URL', async () => {
    const f = fixture();
    const result = await f.binding.commitDirect({
        endpoint: 'https://a.example/v1',
        previousEndpoint: 'https://a.example/v1',
        endpointChanged: false,
        hasNewSecret: true,
        secretValue: 'key-b',
    });
    assert.equal(result.kind, 'created');
    assert.deepEqual(f.calls, [['create', 'key-b', 'https://a.example/v1']]);
    assert.equal(f.state.length, 2);
    assert.equal(f.state[0].active, false);
    assert.equal(f.state[1].active, true);
});

test('case C: changing only the URL rebinds the active Secret', async () => {
    const f = fixture();
    const result = await f.binding.commitDirect({
        endpoint: 'https://b.example/v1',
        previousEndpoint: 'https://a.example/v1',
        endpointChanged: true,
        hasNewSecret: false,
    });
    assert.equal(result.kind, 'rebound');
    assert.deepEqual(f.calls, [
        ['endpoint', 'https://b.example/v1'],
        ['rename', 'a', 'https://b.example/v1'],
    ]);
    assert.equal(f.state[0].label, 'https://b.example/v1');
});

test('case D: changing URL and key preserves the old Secret and creates a bound active Secret', async () => {
    const f = fixture();
    await f.binding.commitDirect({
        endpoint: 'https://b.example/v1',
        previousEndpoint: 'https://a.example/v1',
        endpointChanged: true,
        hasNewSecret: true,
        secretValue: 'key-b',
    });
    assert.deepEqual(f.calls, [
        ['endpoint', 'https://b.example/v1'],
        ['create', 'key-b', 'https://b.example/v1'],
    ]);
    assert.deepEqual(f.state.map(({ label, active }) => ({ label, active })), [
        { label: 'https://a.example/v1', active: false },
        { label: 'https://b.example/v1', active: true },
    ]);
});

test('selecting a Secret changes its URL and active state as one coordinated operation', async () => {
    const f = fixture({ secrets: [
        { id: 'a', label: 'https://a.example/v1', active: true },
        { id: 'b', label: 'https://b.example/v1', active: false },
    ] });
    await f.binding.select({ id: 'b', endpoint: 'https://b.example/v1' });
    assert.deepEqual(f.calls, [
        ['endpoint', 'https://b.example/v1'],
        ['rotate', 'b'],
    ]);
    assert.equal(f.state.find(secret => secret.id === 'b').active, true);
});

test('editing the active Secret updates both its label and the current endpoint', async () => {
    const f = fixture();
    const result = await f.binding.edit({ id: 'a', endpoint: 'https://b.example/v1' });
    assert.equal(result.active, true);
    assert.deepEqual(f.calls, [
        ['endpoint', 'https://b.example/v1'],
        ['rename', 'a', 'https://b.example/v1'],
    ]);
});

test('editing an inactive Secret changes only its label', async () => {
    const f = fixture({ secrets: [
        { id: 'a', label: 'https://a.example/v1', active: true },
        { id: 'b', label: 'old arbitrary label', active: false },
    ] });
    const result = await f.binding.edit({ id: 'b', endpoint: 'https://b.example/v1' });
    assert.equal(result.active, false);
    assert.deepEqual(f.calls, [['rename', 'b', 'https://b.example/v1']]);
    assert.equal(f.endpoints.value, 'https://a.example/v1');
});

test('adding from the manager activates a URL-labeled Secret and synchronizes the endpoint', async () => {
    const f = fixture();
    const result = await f.binding.add({ endpoint: 'https://b.example/v1', value: 'key-b' });
    assert.equal(result.id, 'new');
    assert.deepEqual(f.calls, [
        ['endpoint', 'https://b.example/v1'],
        ['create', 'key-b', 'https://b.example/v1'],
    ]);
    assert.equal(f.state.find(secret => secret.id === 'new').active, true);
});

test('deleting the active Secret synchronizes to the bound successor selected by core', async () => {
    const f = fixture({ secrets: [
        { id: 'a', label: 'https://a.example/v1', active: true },
        { id: 'b', label: 'https://b.example/v1', active: false },
    ] });
    const result = await f.binding.remove('a');
    assert.equal(result.newActiveId, 'b');
    assert.deepEqual(f.calls, [
        ['endpoint', 'https://b.example/v1'],
        ['delete', 'a'],
    ]);
    assert.equal(f.state[0].id, 'b');
    assert.equal(f.state[0].active, true);
});

test('deleting the active Secret is blocked when the successor is legacy-unbound', async () => {
    const f = fixture({ secrets: [
        { id: 'a', label: 'https://a.example/v1', active: true },
        { id: 'b', label: '8/11/2026 9:00 PM', active: false },
    ] });
    await assert.rejects(f.binding.remove('a'), BindingTransactionError);
    assert.deepEqual(f.calls, []);
    assert.equal(f.state.length, 2);
});

test('a definite Secret failure rolls the endpoint back', async () => {
    const f = fixture();
    f.secretApi.create = async () => { throw new Error('write failed'); };
    await assert.rejects(
        f.binding.commitDirect({
            endpoint: 'https://b.example/v1',
            previousEndpoint: 'https://a.example/v1',
            endpointChanged: true,
            hasNewSecret: true,
            secretValue: 'key-b',
        }),
        BindingTransactionError,
    );
    assert.equal(f.endpoints.value, 'https://a.example/v1');
    assert.deepEqual(f.calls, [
        ['endpoint', 'https://b.example/v1'],
        ['endpoint', 'https://a.example/v1'],
    ]);
});

test('an invalid edited endpoint is rejected and restored before any Secret change', async () => {
    const f = fixture();
    f.endpoints.value = 'not a url';
    await assert.rejects(
        f.binding.commitDirect({
            endpoint: 'not a url',
            previousEndpoint: 'https://a.example/v1',
            endpointChanged: true,
            hasNewSecret: false,
        }),
        BindingTransactionError,
    );
    assert.equal(f.endpoints.value, 'https://a.example/v1');
    assert.deepEqual(f.calls, [['endpoint', 'https://a.example/v1']]);
});
