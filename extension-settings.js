const SETTINGS_KEY = 'easyApiSwitcher';
const TEST_BUTTON_ID = 'test_api_button';
const HIDDEN_CLASS = 'easyswitch-test-message-hidden';
const SETTINGS_ROOT_ID = 'easyswitch-settings';
const CHECKBOX_ID = 'easyswitch-hide-test-message';
const DEFAULT_SETTINGS = Object.freeze({
    hideTestMessageButton: true,
});

/**
 * Gets the persisted settings object and fills defaults added by newer versions.
 * Only UI preferences belong here; API keys remain in SillyTavern Secrets.
 *
 * @param {{extensionSettings: Record<string, unknown>}} context
 * @returns {{hideTestMessageButton: boolean}}
 */
export function getExtensionSettings(context) {
    const current = context.extensionSettings[SETTINGS_KEY];
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
        context.extensionSettings[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
    }

    /** @type {Record<string, unknown>} */
    const settings = context.extensionSettings[SETTINGS_KEY];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = value;
        }
    }

    if (typeof settings.hideTestMessageButton !== 'boolean') {
        settings.hideTestMessageButton = DEFAULT_SETTINGS.hideTestMessageButton;
    }
    return /** @type {{hideTestMessageButton: boolean}} */ (settings);
}

/**
 * Adds or removes only EasySwitch's own hiding class. This avoids disturbing
 * any visibility state that SillyTavern or another extension may manage.
 *
 * @param {boolean} hidden
 * @param {{getElementById: (id: string) => Element|null}} [root]
 */
export function applyTestMessageButtonVisibility(hidden, root = document) {
    root.getElementById(TEST_BUTTON_ID)?.classList.toggle(HIDDEN_CLASS, hidden);
}

/** @param {string} moduleUrl */
export function getTemplateModuleName(moduleUrl) {
    const pathname = new URL(moduleUrl).pathname;
    const marker = '/scripts/extensions/';
    const markerIndex = pathname.lastIndexOf(marker);
    const finalSlash = pathname.lastIndexOf('/');
    if (markerIndex === -1 || finalSlash <= markerIndex + marker.length) {
        return 'third-party/Easy-API-Switcher';
    }
    return decodeURIComponent(pathname.slice(markerIndex + marker.length, finalSlash));
}

/**
 * Mounts the native-style Extension Settings drawer and wires persistence.
 * @returns {Promise<void>}
 */
export async function initializeExtensionSettings() {
    const context = SillyTavern.getContext();
    const settings = getExtensionSettings(context);
    applyTestMessageButtonVisibility(settings.hideTestMessageButton);

    if (document.getElementById(SETTINGS_ROOT_ID)) return;

    const container = document.getElementById('extensions_settings2');
    if (!container) {
        throw new Error('The SillyTavern Extension Settings container is unavailable.');
    }

    const moduleName = getTemplateModuleName(import.meta.url);
    const html = await context.renderExtensionTemplateAsync(moduleName, 'settings');
    container.insertAdjacentHTML('beforeend', html);

    const checkbox = document.getElementById(CHECKBOX_ID);
    if (!(checkbox instanceof HTMLInputElement)) {
        throw new Error('The EasySwitch settings checkbox could not be rendered.');
    }

    checkbox.checked = settings.hideTestMessageButton;
    checkbox.addEventListener('change', () => {
        settings.hideTestMessageButton = checkbox.checked;
        applyTestMessageButtonVisibility(checkbox.checked);
        context.saveSettingsDebounced();
    });
}
