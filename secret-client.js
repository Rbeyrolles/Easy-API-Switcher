export const CUSTOM_SECRET_KEY = 'api_key_custom';

export class SecretClientError extends Error {
    /**
     * @param {string} message
     * @param {{ cause?: unknown, uncertain?: boolean, mutationId?: string }} [options]
     */
    constructor(message, { cause, uncertain = false, mutationId } = {}) {
        super(message, { cause });
        this.name = 'SecretClientError';
        this.uncertain = uncertain;
        this.mutationId = mutationId;
    }
}

/**
 * Minimal client for SillyTavern's existing Secrets endpoints.
 * `/read` follows SillyTavern's own allowKeysExposure policy: its value is
 * masked by default and plaintext only when the server explicitly permits it.
 */
export class SecretClient {
    /** @param {() => Record<string, string>} getHeaders */
    constructor(getHeaders) {
        this.getHeaders = getHeaders;
    }

    /** @returns {Promise<Array<{id: string, label: string, active: boolean, value: string, exposed: boolean}>>} */
    async list() {
        const exposure = await this.#getExposureStatus();
        const response = await fetch('/api/secrets/read', {
            method: 'POST',
            headers: this.getHeaders({ omitContentType: true }),
        });

        if (!response.ok) {
            throw new SecretClientError(`Could not read Custom secrets (HTTP ${response.status}).`);
        }

        const state = await response.json();
        const secrets = state?.[CUSTOM_SECRET_KEY];
        if (!Array.isArray(secrets)) {
            return [];
        }

        return secrets
            .filter(secret => secret && typeof secret.id === 'string')
            .map(secret => ({
                id: secret.id,
                label: typeof secret.label === 'string' ? secret.label : '',
                active: secret.active === true,
                // If the settings check itself failed, do not risk treating a
                // potentially plaintext response as safe to display.
                value: exposure === null
                    ? '**********'
                    : (typeof secret.value === 'string' ? secret.value : ''),
                exposed: exposure === true,
            }));
    }

    /** @returns {Promise<boolean|null>} */
    async #getExposureStatus() {
        try {
            const response = await fetch('/api/secrets/settings', {
                method: 'POST',
                headers: this.getHeaders({ omitContentType: true }),
            });
            if (!response.ok) return null;
            const settings = await response.json();
            return settings?.allowKeysExposure === true;
        } catch {
            return null;
        }
    }

    /**
     * @param {string} value A newly entered value; never logged or persisted by this extension.
     * @param {string} label
     * @returns {Promise<string>}
     */
    async create(value, label) {
        const response = await fetch('/api/secrets/write', {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ key: CUSTOM_SECRET_KEY, value, label }),
        });

        if (!response.ok) {
            throw new SecretClientError(`Could not create the Custom secret (HTTP ${response.status}).`);
        }

        const result = await response.json();
        const id = typeof result?.id === 'string' ? result.id : '';
        if (!id) {
            throw new SecretClientError('SillyTavern did not return an ID for the new Custom secret.', { uncertain: true });
        }

        await this.#verify(async secrets => {
            const created = secrets.find(secret => secret.id === id);
            return created?.active === true && created.label === label;
        }, 'The new Custom secret could not be verified.', id);

        return id;
    }

    /** @param {string} id @param {string} label */
    async rename(id, label) {
        await this.#mutate('/api/secrets/rename', { key: CUSTOM_SECRET_KEY, id, label });
        await this.#verify(
            async secrets => secrets.some(secret => secret.id === id && secret.label === label),
            'The Custom secret Base URL update could not be verified.',
        );
    }

    /** @param {string} id */
    async rotate(id) {
        await this.#mutate('/api/secrets/rotate', { key: CUSTOM_SECRET_KEY, id });
        await this.#verify(
            async secrets => secrets.some(secret => secret.id === id && secret.active),
            'The active Custom secret change could not be verified.',
        );
    }

    /**
     * @param {string} id
     * @param {{ verify?: boolean }} [options]
     */
    async delete(id, { verify = true } = {}) {
        await this.#mutate('/api/secrets/delete', { key: CUSTOM_SECRET_KEY, id });
        if (verify) {
            await this.#verify(
                async secrets => !secrets.some(secret => secret.id === id),
                'The Custom secret deletion could not be verified.',
            );
        }
    }

    /** @param {string} path @param {Record<string, string>} body */
    async #mutate(path, body) {
        const response = await fetch(path, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new SecretClientError(`SillyTavern rejected a Custom secret operation (HTTP ${response.status}).`);
        }
    }

    /**
     * Read-back verification with short retries. A failed predicate is a
     * definite mismatch; repeated read failures are marked as uncertain.
     *
     * @param {(secrets: Array<{id: string, label: string, active: boolean, value: string, exposed: boolean}>) => Promise<boolean>|boolean} predicate
     * @param {string} message
     * @param {string} [mutationId]
     */
    async #verify(predicate, message, mutationId) {
        let lastReadError;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const secrets = await this.list();
                if (await predicate(secrets)) {
                    return;
                }
                throw new SecretClientError(message, { mutationId });
            } catch (error) {
                if (error instanceof SecretClientError && !error.uncertain && !String(error.message).startsWith('Could not read')) {
                    throw error;
                }
                lastReadError = error;
                if (attempt < 2) {
                    await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
                }
            }
        }

        throw new SecretClientError(message, {
            cause: lastReadError,
            uncertain: true,
            mutationId,
        });
    }
}
