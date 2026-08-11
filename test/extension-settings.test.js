import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    applyTestMessageButtonVisibility,
    getExtensionSettings,
    getTemplateModuleName,
} from '../extension-settings.js';

test('Extension Settings stores only the hide-button boolean', () => {
    const context = { extensionSettings: {} };
    const settings = getExtensionSettings(context);

    assert.deepEqual(settings, { hideTestMessageButton: false });
    assert.deepEqual(context.extensionSettings, {
        easyApiSwitcher: { hideTestMessageButton: false },
    });

    settings.hideTestMessageButton = true;
    assert.equal(getExtensionSettings(context).hideTestMessageButton, true);
});

test('invalid persisted setting values fail closed to the visible default', () => {
    const context = {
        extensionSettings: {
            easyApiSwitcher: { hideTestMessageButton: 'true' },
        },
    };

    assert.deepEqual(getExtensionSettings(context), { hideTestMessageButton: false });
});

test('visibility helper toggles only the EasySwitch class on the native button', () => {
    const calls = [];
    const root = {
        getElementById(id) {
            assert.equal(id, 'test_api_button');
            return { classList: { toggle: (...args) => calls.push(args) } };
        },
    };

    applyTestMessageButtonVisibility(true, root);
    applyTestMessageButtonVisibility(false, root);
    assert.deepEqual(calls, [
        ['easyswitch-test-message-hidden', true],
        ['easyswitch-test-message-hidden', false],
    ]);
});

test('template module path follows the installed third-party folder name', () => {
    assert.equal(
        getTemplateModuleName('https://localhost/scripts/extensions/third-party/My%20Switcher/extension-settings.js'),
        'third-party/My Switcher',
    );
    assert.equal(
        getTemplateModuleName('file:///workspace/extension-settings.js'),
        'third-party/Easy-API-Switcher',
    );
});

test('settings template uses SillyTavern drawer and checkbox vocabulary', async () => {
    const html = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    assert.match(html, /class="inline-drawer"/);
    assert.match(html, /class="inline-drawer-toggle inline-drawer-header"/);
    assert.match(html, /id="easyswitch-hide-test-message" type="checkbox"/);
    assert.match(html, /data-i18n="Hide Test Message button"/);
});
