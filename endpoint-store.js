import { cleanEndpoint } from './url-utils.js';

export class EndpointStoreError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'EndpointStoreError';
    }
}

/**
 * Applies a Custom URL through the native input handler and waits until the
 * normal SillyTavern settings save reports completion.
 */
export class EndpointStore {
    /** @param {() => ReturnType<SillyTavern['getContext']>} getContext */
    constructor(getContext) {
        this.getContext = getContext;
    }

    current() {
        return cleanEndpoint(this.getContext().chatCompletionSettings?.custom_url);
    }

    /** @param {string} endpoint */
    async set(endpoint) {
        const target = cleanEndpoint(endpoint);
        const input = document.getElementById('custom_api_url_text');
        if (!(input instanceof HTMLInputElement)) {
            throw new EndpointStoreError('The native Custom Endpoint input is unavailable.');
        }

        const context = this.getContext();
        const eventType = context.eventTypes.SETTINGS_UPDATED;
        let timeoutId;
        let handler;

        const saved = new Promise((resolve, reject) => {
            handler = () => {
                clearTimeout(timeoutId);
                context.eventSource.removeListener(eventType, handler);
                resolve();
            };
            context.eventSource.on(eventType, handler);
            timeoutId = setTimeout(() => {
                context.eventSource.removeListener(eventType, handler);
                reject(new EndpointStoreError('Timed out while saving the Custom Endpoint setting.'));
            }, 7000);
        });

        input.value = target;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        context.saveSettingsDebounced();

        try {
            await saved;
        } finally {
            clearTimeout(timeoutId);
            if (handler) {
                context.eventSource.removeListener(eventType, handler);
            }
        }

        if (this.current() !== target) {
            throw new EndpointStoreError('SillyTavern did not retain the requested Custom Endpoint.');
        }
    }
}
