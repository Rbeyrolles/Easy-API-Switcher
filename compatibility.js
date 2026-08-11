import { CUSTOM_SECRET_KEY } from './secret-client.js';

let coreSecretsModulePromise;

/**
 * Refreshes SillyTavern's own in-memory secret_state after this extension uses
 * the existing Secrets HTTP API. This is the extension's only internal-module
 * dependency and is deliberately isolated in this file.
 */
export async function refreshCoreSecretState() {
    try {
        coreSecretsModulePromise ??= import('/scripts/secrets.js');
        const module = await coreSecretsModulePromise;
        if (typeof module.readSecretState !== 'function') {
            throw new Error('readSecretState is not exported');
        }
        await module.readSecretState();
    } catch (error) {
        console.warn('[EasySwitch] Could not refresh the native secret display.', error);
    }
}

/** @param {string} eventType */
export async function emitSecretEvent(eventType) {
    const context = SillyTavern.getContext();
    await context.eventSource.emit(eventType, CUSTOM_SECRET_KEY);
}

/** Reproduces the native rotate/delete refresh without importing core state. */
export function triggerNativeApiRefresh() {
    const mainApi = document.getElementById('main_api');
    if (mainApi) {
        mainApi.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

/** Runs the untouched native Chat Completion connect handler. */
export function triggerNativeCustomConnect() {
    const button = document.getElementById('api_button_openai');
    if (button instanceof HTMLElement) {
        button.click();
    }
}
