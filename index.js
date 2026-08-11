import { BindingService, BindingTransactionError } from './binding-service.js';
import { emitSecretEvent, refreshCoreSecretState, triggerNativeApiRefresh, triggerNativeCustomConnect } from './compatibility.js';
import { EndpointStore } from './endpoint-store.js';
import { initializeExtensionSettings } from './extension-settings.js';
import { CustomSecretManager } from './manager.js';
import { SecretClient } from './secret-client.js';
import { cleanEndpoint, endpointsEqual } from './url-utils.js';

const MODULE_NAME = 'EasySwitch';
let initialized = false;
let connectBusy = false;
let committedEndpoint = '';
let manager;

function context() {
    return SillyTavern.getContext();
}

function tr(text) {
    return context().translate(text);
}

function isCustomChatCompletion() {
    const current = context();
    return current.mainApi === 'openai'
        && current.chatCompletionSettings?.chat_completion_source === 'custom';
}

function rememberCurrentEndpoint() {
    committedEndpoint = cleanEndpoint(context().chatCompletionSettings?.custom_url);
}

/** @param {unknown} error */
function reportError(error) {
    const transaction = error instanceof BindingTransactionError ? error : null;
    const message = error instanceof Error ? tr(error.message) : tr('An unknown EasySwitch error occurred.');
    let detail = message;
    if (transaction?.uncertain) {
        detail += ` ${tr('SillyTavern accepted the operation, but its final state could not be verified. The window was kept open; refresh before retrying.')}`;
    }
    if (transaction?.rollbackErrors?.length) {
        detail += ` ${tr('Automatic rollback was incomplete. Reload SillyTavern before making another connection change.')}`;
    }
    toastr.error(detail, tr('EasySwitch could not complete the change'), { timeOut: 10000, extendedTimeOut: 5000 });
    // Log only the error class/message. Never dump arbitrary error properties,
    // because future fetch wrappers could attach request bodies to them.
    const safeName = error instanceof Error ? error.name : 'UnknownError';
    const safeMessage = error instanceof Error ? error.message : 'Unknown failure';
    console.error(`[${MODULE_NAME}] ${safeName}: ${safeMessage}`);
}

async function notifyMutation(kind, { activeEndpoint, refreshApi = false } = {}) {
    const eventMap = {
        written: context().eventTypes.SECRET_WRITTEN,
        edited: context().eventTypes.SECRET_EDITED,
        rotated: context().eventTypes.SECRET_ROTATED,
        deleted: context().eventTypes.SECRET_DELETED,
    };
    await refreshCoreSecretState();
    await emitSecretEvent(eventMap[kind]);
    if (activeEndpoint) {
        committedEndpoint = cleanEndpoint(activeEndpoint);
    }
    if (refreshApi) {
        triggerNativeApiRefresh();
    }
}

async function handleDirectConnect() {
    if (connectBusy) return;
    const button = document.getElementById('api_button_openai');
    const endpointInput = document.getElementById('custom_api_url_text');
    const keyInput = document.getElementById('api_key_custom');
    if (!(button instanceof HTMLElement) || !(endpointInput instanceof HTMLInputElement) || !(keyInput instanceof HTMLInputElement)) {
        reportError(new Error('The native Custom connection controls are unavailable.'));
        return;
    }

    connectBusy = true;
    button.classList.add('disabled');
    button.setAttribute('aria-busy', 'true');
    const endpoint = cleanEndpoint(endpointInput.value);
    const secretValue = keyInput.value.trim();
    const hasNewSecret = secretValue.length > 0;
    const endpointChanged = !endpointsEqual(endpoint, committedEndpoint);

    try {
        const result = await manager.binding.commitDirect({
            endpoint,
            previousEndpoint: committedEndpoint,
            endpointChanged,
            hasNewSecret,
            secretValue,
        });

        if (result.kind === 'created') {
            keyInput.value = '';
            keyInput.dispatchEvent(new Event('input', { bubbles: true }));
            await notifyMutation('written', { activeEndpoint: endpoint });
        } else if (result.kind === 'rebound') {
            await notifyMutation('edited', { activeEndpoint: endpoint });
        } else if (result.kind === 'endpoint-only') {
            committedEndpoint = endpoint;
        }

        if (endpointChanged && result.kind !== 'unchanged') {
            committedEndpoint = endpoint;
        }
        triggerNativeCustomConnect();
    } catch (error) {
        reportError(error);
        endpointInput.focus();
    } finally {
        // Do not retain a user-entered key beyond this operation.
        connectBusy = false;
        button.classList.remove('disabled');
        button.removeAttribute('aria-busy');
    }
}

function interceptClicks(event) {
    if (!(event.target instanceof Element)) return;

    const manageButton = event.target.closest('.manage-api-keys[data-key="api_key_custom"]');
    if (manageButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void manager.open();
        return;
    }

    const connectButton = event.target.closest('#api_button_openai');
    // Programmatic clicks are used extensively by Connection Profiles and
    // slash commands. Only a trusted user click is intercepted.
    if (connectButton && event.isTrusted && isCustomChatCompletion()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void handleDirectConnect();
    }
}

async function initialize() {
    if (initialized) return;
    initialized = true;

    const secrets = new SecretClient(options => context().getRequestHeaders(options));
    const endpoints = new EndpointStore(context);
    const binding = new BindingService({ secrets, endpoints });
    manager = new CustomSecretManager({ binding, secrets, onMutation: notifyMutation, reportError });
    rememberCurrentEndpoint();

    document.addEventListener('click', interceptClicks, true);
    document.addEventListener('focusin', event => {
        if (event.target instanceof Element && event.target.matches('#custom_api_url_text')) {
            rememberCurrentEndpoint();
        }
    }, true);

    const current = context();
    const syncEvents = [
        current.eventTypes.CONNECTION_PROFILE_LOADED,
        current.eventTypes.CHATCOMPLETION_SOURCE_CHANGED,
        current.eventTypes.MAIN_API_CHANGED,
    ];
    for (const eventType of syncEvents) {
        current.eventSource.on(eventType, () => queueMicrotask(rememberCurrentEndpoint));
    }

    try {
        await initializeExtensionSettings();
    } catch (error) {
        const safeMessage = error instanceof Error ? error.message : 'Unknown settings error';
        console.error(`[${MODULE_NAME}] Could not initialize Extension Settings: ${safeMessage}`);
    }

    console.info(`[${MODULE_NAME}] Custom API Secret bindings enabled.`);
}

context().eventSource.on(context().eventTypes.APP_INITIALIZED, initialize);
