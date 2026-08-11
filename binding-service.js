import { cleanEndpoint, endpointsEqual, isBindableEndpoint } from './url-utils.js';

export class BindingTransactionError extends Error {
    /**
     * @param {string} message
     * @param {{ cause?: unknown, rollbackErrors?: unknown[], uncertain?: boolean }} [options]
     */
    constructor(message, { cause, rollbackErrors = [], uncertain = false } = {}) {
        super(message, { cause });
        this.name = 'BindingTransactionError';
        this.rollbackErrors = rollbackErrors;
        this.uncertain = uncertain;
    }
}

/**
 * Coordinates the two existing SillyTavern stores: ordinary connection
 * settings for the endpoint, and secrets.json for Secret IDs/labels/active
 * state. No API key is kept on this object.
 */
export class BindingService {
    /**
     * @param {{
     *   secrets: { list: Function, create: Function, rename: Function, rotate: Function, delete: Function },
     *   endpoints: { current: Function, set: Function }
     * }} dependencies
     */
    constructor({ secrets, endpoints }) {
        this.secrets = secrets;
        this.endpoints = endpoints;
        this.queue = Promise.resolve();
    }

    /** @param {() => Promise<any>} operation */
    exclusive(operation) {
        const next = this.queue.then(operation, operation);
        this.queue = next.catch(() => undefined);
        return next;
    }

    /**
     * Implements direct API Connections cases A-D.
     *
     * @param {{endpoint: string, previousEndpoint: string, endpointChanged: boolean, hasNewSecret: boolean, secretValue?: string}} input
     */
    commitDirect(input) {
        return this.exclusive(async () => {
            const endpoint = cleanEndpoint(input.endpoint);
            const previousEndpoint = cleanEndpoint(input.previousEndpoint);

            if (!input.endpointChanged && !input.hasNewSecret) {
                return { kind: 'unchanged' };
            }

            if (!isBindableEndpoint(endpoint)) {
                const rollbackErrors = [];
                if (input.endpointChanged) {
                    await this.#attempt(() => this.endpoints.set(previousEndpoint), rollbackErrors);
                }
                throw new BindingTransactionError('Enter a valid HTTP(S) Custom Endpoint without embedded credentials.', { rollbackErrors });
            }

            const before = await this.secrets.list();
            const active = before.find(secret => secret.active) ?? null;
            const endpointWasApplied = input.endpointChanged;

            if (endpointWasApplied) {
                await this.endpoints.set(endpoint);
            }

            if (input.hasNewSecret) {
                try {
                    const id = await this.secrets.create(input.secretValue ?? '', endpoint);
                    return { kind: 'created', id };
                } catch (error) {
                    const rollbackErrors = [];
                    if (error?.mutationId) {
                        await this.#attempt(() => this.secrets.delete(error.mutationId, { verify: false }), rollbackErrors);
                        if (active) {
                            await this.#attempt(() => this.secrets.rotate(active.id), rollbackErrors);
                        }
                    }
                    if (endpointWasApplied && !error?.uncertain) {
                        await this.#attempt(() => this.endpoints.set(previousEndpoint), rollbackErrors);
                    }
                    throw this.#transactionFailure('The new Custom secret was not committed.', error, rollbackErrors);
                }
            }

            if (!active) {
                return { kind: 'endpoint-only' };
            }

            try {
                await this.secrets.rename(active.id, endpoint);
                return { kind: 'rebound', id: active.id };
            } catch (error) {
                const rollbackErrors = [];
                if (!error?.uncertain) {
                    if (active.label) {
                        await this.#attempt(() => this.secrets.rename(active.id, active.label), rollbackErrors);
                    }
                    await this.#attempt(() => this.endpoints.set(previousEndpoint), rollbackErrors);
                }
                throw this.#transactionFailure('The active Custom secret was not rebound.', error, rollbackErrors);
            }
        });
    }

    /** @param {{endpoint: string, value: string}} input */
    add(input) {
        return this.exclusive(async () => {
            const endpoint = this.#valid(input.endpoint);
            const previousEndpoint = this.endpoints.current();
            const before = await this.secrets.list();
            const active = before.find(secret => secret.active) ?? null;
            const endpointChanged = !endpointsEqual(endpoint, previousEndpoint);

            if (endpointChanged) {
                await this.endpoints.set(endpoint);
            }

            try {
                const id = await this.secrets.create(input.value, endpoint);
                return { id };
            } catch (error) {
                const rollbackErrors = [];
                if (error?.mutationId) {
                    await this.#attempt(() => this.secrets.delete(error.mutationId, { verify: false }), rollbackErrors);
                    if (active) {
                        await this.#attempt(() => this.secrets.rotate(active.id), rollbackErrors);
                    }
                }
                if (endpointChanged && !error?.uncertain) {
                    await this.#attempt(() => this.endpoints.set(previousEndpoint), rollbackErrors);
                }
                throw this.#transactionFailure('The Custom secret was not added.', error, rollbackErrors);
            }
        });
    }

    /** @param {{id: string, endpoint: string}} input */
    select(input) {
        return this.exclusive(async () => {
            const endpoint = this.#valid(input.endpoint);
            const previousEndpoint = this.endpoints.current();
            const before = await this.secrets.list();
            const target = before.find(secret => secret.id === input.id);
            const previousActive = before.find(secret => secret.active) ?? null;
            if (!target) {
                throw new BindingTransactionError('The selected Custom secret no longer exists.');
            }

            const endpointChanged = !endpointsEqual(endpoint, previousEndpoint);
            if (endpointChanged) {
                await this.endpoints.set(endpoint);
            }

            try {
                await this.secrets.rotate(target.id);
                return { id: target.id };
            } catch (error) {
                const rollbackErrors = [];
                if (!error?.uncertain) {
                    if (previousActive) {
                        await this.#attempt(() => this.secrets.rotate(previousActive.id), rollbackErrors);
                    }
                    if (endpointChanged) {
                        await this.#attempt(() => this.endpoints.set(previousEndpoint), rollbackErrors);
                    }
                }
                throw this.#transactionFailure('The Custom connection was not switched.', error, rollbackErrors);
            }
        });
    }

    /** @param {{id: string, endpoint: string}} input */
    edit(input) {
        return this.exclusive(async () => {
            const endpoint = this.#valid(input.endpoint);
            const before = await this.secrets.list();
            const target = before.find(secret => secret.id === input.id);
            if (!target) {
                throw new BindingTransactionError('The Custom secret no longer exists.');
            }

            if (!target.active) {
                await this.secrets.rename(target.id, endpoint);
                return { id: target.id, active: false };
            }

            const previousEndpoint = this.endpoints.current();
            const endpointChanged = !endpointsEqual(endpoint, previousEndpoint);
            if (endpointChanged) {
                await this.endpoints.set(endpoint);
            }

            try {
                await this.secrets.rename(target.id, endpoint);
                return { id: target.id, active: true };
            } catch (error) {
                const rollbackErrors = [];
                if (!error?.uncertain) {
                    if (target.label) {
                        await this.#attempt(() => this.secrets.rename(target.id, target.label), rollbackErrors);
                    }
                    if (endpointChanged) {
                        await this.#attempt(() => this.endpoints.set(previousEndpoint), rollbackErrors);
                    }
                }
                throw this.#transactionFailure('The Custom secret Base URL was not updated.', error, rollbackErrors);
            }
        });
    }

    /** @param {string} id */
    remove(id) {
        return this.exclusive(async () => {
            const before = await this.secrets.list();
            const target = before.find(secret => secret.id === id);
            if (!target) {
                throw new BindingTransactionError('The Custom secret no longer exists.');
            }

            let successor = null;
            let previousEndpoint = this.endpoints.current();
            let endpointChanged = false;
            if (target.active && before.length > 1) {
                successor = before.find(secret => secret.id !== id) ?? null;
                if (!successor || !isBindableEndpoint(successor.label)) {
                    throw new BindingTransactionError('Bind another Secret to a valid Base URL before deleting the active Secret.');
                }
                endpointChanged = !endpointsEqual(successor.label, previousEndpoint);
                if (endpointChanged) {
                    await this.endpoints.set(successor.label);
                }
            }

            try {
                await this.secrets.delete(id);
                return { id, newActiveId: successor?.id ?? null };
            } catch (error) {
                const rollbackErrors = [];
                if (endpointChanged && !error?.uncertain) {
                    await this.#attempt(() => this.endpoints.set(previousEndpoint), rollbackErrors);
                }
                throw this.#transactionFailure('The Custom secret was not deleted.', error, rollbackErrors);
            }
        });
    }

    /** @param {string} endpoint */
    #valid(endpoint) {
        const clean = cleanEndpoint(endpoint);
        if (!isBindableEndpoint(clean)) {
            throw new BindingTransactionError('Enter a valid HTTP(S) Base URL without embedded credentials.');
        }
        return clean;
    }

    /** @param {() => Promise<unknown>} operation @param {unknown[]} errors */
    async #attempt(operation, errors) {
        try {
            await operation();
        } catch (error) {
            errors.push(error);
        }
    }

    /** @param {string} message @param {any} cause @param {unknown[]} rollbackErrors */
    #transactionFailure(message, cause, rollbackErrors) {
        return new BindingTransactionError(message, {
            cause,
            rollbackErrors,
            uncertain: cause?.uncertain === true,
        });
    }
}
