import { BindingTransactionError } from './binding-service.js';
import { cleanEndpoint, isBindableEndpoint } from './url-utils.js';

/** @param {string} tag @param {string} [className] @param {string} [text] */
function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

export class CustomSecretManager {
    /**
     * @param {{
     *  binding: import('./binding-service.js').BindingService,
     *  secrets: import('./secret-client.js').SecretClient,
     *  onMutation: (kind: 'written'|'edited'|'rotated'|'deleted', options?: {activeEndpoint?: string, refreshApi?: boolean}) => Promise<void>,
     *  reportError: (error: unknown) => void,
     * }} dependencies
     */
    constructor({ binding, secrets, onMutation, reportError }) {
        this.binding = binding;
        this.secrets = secrets;
        this.onMutation = onMutation;
        this.reportError = reportError;
        this.popup = null;
        this.root = null;
        this.list = null;
        this.busy = false;
    }

    tr(text) {
        return SillyTavern.getContext().translate(text);
    }

    async open() {
        if (this.popup) {
            return;
        }

        const context = SillyTavern.getContext();
        this.root = this.#buildRoot();
        this.popup = new context.Popup(this.root, context.POPUP_TYPE.TEXT, '', {
            wide: true,
            large: true,
            allowVerticalScrolling: true,
            okButton: this.tr('Close'),
            onClose: () => {
                this.popup = null;
                this.root = null;
                this.list = null;
            },
        });

        const closed = this.popup.show();
        await this.refresh();
        await closed;
    }

    #buildRoot() {
        const root = element('div', 'easyswitch-manager secretKeyManager');
        const header = element('div', 'easyswitch-manager-header');
        const titleRow = element('div', 'easyswitch-title-row');
        const titleBlock = element('div', 'easyswitch-title-block');
        titleBlock.append(element('h3', '', this.tr('Custom API connections')));

        const add = this.#actionButton('add', 'fa-plus', this.tr('Add connection'));
        add.classList.add('menu_button_icon');
        titleRow.append(titleBlock, add);

        header.append(titleRow);

        this.list = element('div', 'easyswitch-secret-list secretKeyManagerList');
        root.append(header, element('hr'), this.list);
        root.addEventListener('click', event => void this.#handleAction(event));
        return root;
    }

    async refresh() {
        if (!this.list) return;
        this.#setBusy(true);
        try {
            const secrets = await this.secrets.list();
            this.list.replaceChildren(...secrets.map(secret => this.#renderSecret(secret)));
        } catch (error) {
            this.list.replaceChildren(element('div', 'easyswitch-load-error', this.tr('Could not load Custom secrets. Close this window and try again.')));
            this.reportError(error);
        } finally {
            this.#setBusy(false);
        }
    }

    /** @param {{id: string, label: string, active: boolean, value: string, exposed: boolean}} secret */
    #renderSecret(secret) {
        const item = element('div', `easyswitch-secret-item secretKeyManagerItem${secret.active ? ' active' : ''}`);
        item.dataset.id = secret.id;

        const info = element('div', 'easyswitch-secret-info secretKeyManagerItemInfo');
        const header = element('div', 'easyswitch-secret-header');
        const bound = isBindableEndpoint(secret.label);
        const endpoint = element('strong', bound ? 'easyswitch-endpoint' : 'easyswitch-unbound');
        endpoint.textContent = bound ? secret.label : this.tr('Base URL not set');
        header.append(endpoint);
        if (secret.active) {
            header.append(element('span', 'easyswitch-active-badge', this.tr('Active')));
        }
        info.append(header);

        if (!bound && secret.label) {
            const legacy = element('small', 'easyswitch-legacy-label');
            legacy.textContent = `${this.tr('Legacy label')}: ${secret.label}`;
            info.append(legacy);
        }

        const keyRow = element('div', 'easyswitch-key-row secretKeyManagerItemSubtitle');
        const displayedKey = secret.exposed && secret.value === '' ? this.tr('[Empty]') : secret.value;
        keyRow.append(element('strong', '', `${this.tr('Key')}:`), element('code', '', displayedKey));
        info.append(keyRow);

        const actions = element('div', 'easyswitch-actions secretKeyManagerItemActions');
        const select = this.#actionButton('select', 'fa-check', this.tr('Select connection'), secret.id);
        select.disabled = secret.active;
        select.classList.toggle('disabled', secret.active);
        const copy = this.#actionButton('copy-key', 'fa-copy', this.tr('Copy API Key'), secret.id);
        const edit = this.#actionButton('edit', 'fa-pen-to-square', this.tr('Edit connection'), secret.id);
        const remove = this.#actionButton('delete', 'fa-trash', this.tr('Delete Secret'), secret.id);
        actions.append(select, copy, edit, remove);
        item.append(info, actions);
        return item;
    }

    /** @param {string} action @param {string} icon @param {string} title @param {string} [id] */
    #actionButton(action, icon, title, id = '') {
        const button = element('button', 'menu_button menu_button_icon easyswitch-action');
        button.type = 'button';
        button.dataset.action = action;
        if (id) button.dataset.id = id;
        button.title = title;
        button.setAttribute('aria-label', title);
        const image = element('i', `fa-fw fa-solid ${icon}`);
        button.append(image);
        if (action === 'add') {
            button.append(element('span', '', title));
        }
        return button;
    }

    async #handleAction(event) {
        if (this.busy) return;
        const button = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
        if (!(button instanceof HTMLButtonElement) || button.disabled) return;

        const action = button.dataset.action;
        const id = button.dataset.id ?? '';
        if (action === 'add') await this.#add();
        if (action === 'select') await this.#select(id);
        if (action === 'copy-key') await this.#copyKey(id);
        if (action === 'edit') await this.#edit(id);
        if (action === 'delete') await this.#delete(id);
    }

    async #add() {
        const wrapper = element('div', 'easyswitch-form');
        const endpoint = this.#field(wrapper, this.tr('Base URL'), 'url', 'https://api.example.com/v1');
        endpoint.value = SillyTavern.getContext().chatCompletionSettings?.custom_url ?? '';
        const key = this.#field(wrapper, this.tr('API Key (may be empty for a keyless endpoint)'), 'password', '');
        key.autocomplete = 'new-password';

        const success = await this.#validatedPopup({
            content: wrapper,
            okText: this.tr('Add connection'),
            operation: async () => {
                if (!key.value) {
                    const confirmed = await SillyTavern.getContext().Popup.show.confirm(
                        this.tr('Create a keyless Secret?'),
                        this.tr('No API Key was entered. The new Secret will contain an empty value.'),
                    );
                    if (!confirmed) return false;
                }
                const result = await this.binding.add({ endpoint: endpoint.value, value: key.value });
                key.value = '';
                await this.onMutation('written', { activeEndpoint: cleanEndpoint(endpoint.value) });
                return Boolean(result.id);
            },
        });

        if (success) await this.refresh();
    }

    /** @param {string} id */
    async #select(id) {
        let secrets = await this.secrets.list();
        let target = secrets.find(secret => secret.id === id);
        if (!target) {
            this.reportError(new BindingTransactionError('The selected Custom secret no longer exists.'));
            return;
        }

        if (!isBindableEndpoint(target.label)) {
            // Selection only needs the missing Base URL. Allowing a Key
            // replacement here would create a new active Secret and then the
            // remaining selection flow would incorrectly rotate back to `id`.
            const edited = await this.#edit(id, { allowKeyChange: false });
            if (!edited) return;
            secrets = await this.secrets.list();
            target = secrets.find(secret => secret.id === id);
            if (!target || !isBindableEndpoint(target.label)) return;
        }

        this.#setBusy(true);
        try {
            await this.binding.select({ id, endpoint: target.label });
            await this.onMutation('rotated', { activeEndpoint: target.label, refreshApi: true });
            await this.popup?.completeAffirmative();
        } catch (error) {
            this.reportError(error);
            await this.refresh();
        } finally {
            this.#setBusy(false);
        }
    }

    /**
     * @param {string} id
     * @param {{allowKeyChange?: boolean}} [options]
     * @returns {Promise<boolean>}
     */
    async #edit(id, { allowKeyChange = true } = {}) {
        const secrets = await this.secrets.list();
        const target = secrets.find(secret => secret.id === id);
        if (!target) {
            this.reportError(new BindingTransactionError('The Custom secret no longer exists.'));
            return false;
        }

        const wrapper = element('div', 'easyswitch-form');
        const endpoint = this.#field(wrapper, this.tr('Base URL'), 'url', 'https://api.example.com/v1');
        endpoint.value = isBindableEndpoint(target.label) ? target.label : '';
        const key = allowKeyChange
            ? this.#field(wrapper, this.tr('API Key'), 'text', '')
            : null;
        let originalKey = null;
        if (key) {
            key.autocomplete = 'off';
        }
        if (key && target.exposed) {
            key.value = target.value;
            originalKey = target.value;
        } else if (key) {
            key.placeholder = this.tr('Enter a new Key, or leave blank to keep the current Secret');
        }
        if (!isBindableEndpoint(target.label) && target.label) {
            wrapper.append(element('small', 'easyswitch-legacy-label', `${this.tr('Legacy label')}: ${target.label}`));
        }

        const success = await this.#validatedPopup({
            content: wrapper,
            okText: this.tr('Save connection'),
            operation: async () => {
                const hasNewKey = key && (originalKey === null
                    ? key.value.length > 0
                    : key.value !== originalKey);
                if (hasNewKey) {
                    if (!key.value) {
                        const confirmed = await SillyTavern.getContext().Popup.show.confirm(
                            this.tr('Create a keyless Secret?'),
                            this.tr('No API Key was entered. The new Secret will contain an empty value.'),
                        );
                        if (!confirmed) return false;
                    }
                    const result = await this.binding.add({ endpoint: endpoint.value, value: key.value });
                    key.value = '';
                    originalKey = null;
                    await this.onMutation('written', { activeEndpoint: cleanEndpoint(endpoint.value) });
                    return Boolean(result.id);
                }

                const result = await this.binding.edit({ id, endpoint: endpoint.value });
                if (key) key.value = '';
                originalKey = null;
                await this.onMutation('edited', result.active ? { activeEndpoint: cleanEndpoint(endpoint.value) } : {});
                return true;
            },
        });

        if (success) await this.refresh();
        return success;
    }

    /** @param {string} id */
    async #delete(id) {
        const secrets = await this.secrets.list();
        const target = secrets.find(secret => secret.id === id);
        if (!target) return;
        const label = isBindableEndpoint(target.label) ? target.label : this.tr('Unbound Custom Secret');
        const confirmed = await SillyTavern.getContext().Popup.show.confirm(
            this.tr('Delete Custom Secret'),
            `${label}\n\n${this.tr('This action cannot be undone.')}`,
        );
        if (!confirmed) return;

        this.#setBusy(true);
        try {
            const result = await this.binding.remove(id);
            const activeEndpoint = result.newActiveId
                ? (await this.secrets.list()).find(secret => secret.id === result.newActiveId)?.label
                : undefined;
            await this.onMutation('deleted', {
                activeEndpoint: isBindableEndpoint(activeEndpoint) ? activeEndpoint : undefined,
                refreshApi: target.active,
            });
            await this.refresh();
        } catch (error) {
            this.reportError(error);
            await this.refresh();
        } finally {
            this.#setBusy(false);
        }
    }

    /** @param {string} id */
    async #copyKey(id) {
        try {
            const secret = (await this.secrets.list()).find(item => item.id === id);
            if (!secret) {
                throw new Error('Secret not found');
            }
            if (!secret.exposed) {
                toastr.error(this.tr('SillyTavern is hiding API keys. Enable allowKeysExposure in config.yaml to copy the plaintext Key.'));
                return;
            }
            await navigator.clipboard.writeText(secret.value);
            toastr.info(this.tr('API Key copied.'));
        } catch {
            toastr.error(this.tr('Could not copy the API Key.'));
        }
    }

    /**
     * @param {{content: HTMLElement, okText: string, operation: () => Promise<boolean>}} options
     * @returns {Promise<boolean>}
     */
    async #validatedPopup({ content, okText, operation }) {
        const context = SillyTavern.getContext();
        let committed = false;
        const popup = new context.Popup(content, context.POPUP_TYPE.TEXT, '', {
            okButton: okText,
            cancelButton: this.tr('Cancel'),
            onClosing: async instance => {
                if (instance.result !== context.POPUP_RESULT.AFFIRMATIVE) return true;
                this.#setPopupBusy(instance, true);
                try {
                    committed = await operation();
                    return committed;
                } catch (error) {
                    this.reportError(error);
                    return false;
                } finally {
                    this.#setPopupBusy(instance, false);
                }
            },
        });
        await popup.show();
        return committed;
    }

    /** @param {HTMLElement} wrapper @param {string} label @param {string} type @param {string} placeholder */
    #field(wrapper, label, type, placeholder) {
        const field = element('label', 'easyswitch-field');
        field.append(element('span', '', label));
        const input = element('input', 'text_pole wide100p');
        input.type = type;
        input.placeholder = placeholder;
        field.append(input);
        wrapper.append(field);
        return input;
    }

    #setBusy(state) {
        this.busy = state;
        if (!this.root) return;
        this.root.setAttribute('aria-busy', String(state));
        this.root.querySelectorAll('button').forEach(button => {
            if (!(button instanceof HTMLButtonElement)) return;
            const isActiveSelect = button.dataset.action === 'select' && button.closest('.active');
            button.disabled = state || Boolean(isActiveSelect);
        });
    }

    /** @param {import('../../scripts/popup.js').Popup|any} popup @param {boolean} state */
    #setPopupBusy(popup, state) {
        popup.dlg?.setAttribute('aria-busy', String(state));
        popup.dlg?.querySelectorAll('button, input').forEach(control => {
            control.disabled = state;
        });
    }
}
