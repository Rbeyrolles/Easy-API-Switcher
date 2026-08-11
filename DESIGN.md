# Design and source findings

This design was derived from the SillyTavern 1.18.0 checkout supplied with the
extension, the official UI Extension guide, the official Connection Profiles
documentation, and the supplied desktop/mobile UI captures.

Official references:

- <https://docs.sillytavern.app/for-contributors/writing-extensions/>
- <https://docs.sillytavern.app/usage/core-concepts/connection-profiles/>

## Core data flow in 1.18.0

### Secrets

`public/scripts/secrets.js` maps Custom Chat Completion to
`api_key_custom`. `writeSecret()` posts `{ key, value, label }`, refreshes the
masked Secret state, and emits `SECRET_WRITTEN`. `rotateSecret()` changes the
active ID and emits `SECRET_ROTATED`; `renameSecret()` changes only `label`.

`src/endpoints/secrets.js` stores an array per key in `secrets.json`:

```text
{ id, value, label, active }
```

`SecretManager.writeSecret()` deactivates the existing entries and appends one
new active entry. The complete secrets file is written atomically. The `/read`
endpoint returns IDs, labels, active flags, and values masked according to the
server's `allowKeysExposure` setting. EasySwitch checks `/api/secrets/settings`
before deciding whether those values may be rendered or copied. `/find` and
`/view` are not used.

Core exposes no operation for replacing the value of an existing Secret ID.
Consequently, editing a connection with a different Key uses `/write`: it
creates a new active Secret with the chosen Base URL and preserves the old
Secret. A URL-only edit still renames the existing Secret in place.

### Custom Chat Completion

`public/scripts/openai.js` keeps the endpoint in
`oai_settings.custom_url`. The `#custom_api_url_text` input updates that setting
on every `input` event and schedules a normal settings save.

On `#api_button_openai`, the native handler reads `#api_key_custom`. A non-empty
value calls `writeSecret(SECRET_KEYS.CUSTOM, apiKey)` without a label, so core
generates a date/time label. It then saves settings and performs the status
request. The server-side Custom backend independently combines
`request.body.custom_url` with the active (or explicitly requested) Custom
Secret.

This explains the missing association: URL and Secret are consumed together,
but are stored and edited independently.

### Connection Profiles

The built-in `public/scripts/extensions/connection-manager/index.js` stores both
`api-url` and `secret-id`. For Chat Completion, its command order is:

```text
api → preset → api → api-url → model → … → secret-id → …
```

The `/api-url` callback writes `custom_url` and, by default, programmatically
clicks the native connect button. The profile's Secret is rotated only later by
`/secret-id`. Finally, `CONNECTION_PROFILE_LOADED` is emitted.

Consequences:

1. A listener that maps every `SECRET_ROTATED` to the label URL is unsafe. It
   can override the URL a profile has intentionally restored.
2. A blanket patch of the native connect handler is also unsafe because the
   profile invokes it midway through restoration.
3. EasySwitch therefore intercepts only `Event.isTrusted` Custom connect
   clicks. Profile/slash-command synthetic clicks remain native.
4. EasySwitch listens to `CONNECTION_PROFILE_LOADED` only to reset its edit
   baseline; it does not write anything in response.

## Chosen extension boundary

The Custom key button is intercepted in the capture phase before the native
delegated manager opens. No other `data-key` is intercepted. The custom popup
uses `SillyTavern.getContext().Popup` and native CSS vocabulary, but owns its DOM
so it does not patch a core Handlebars template or monkey-patch a private
function.

Key visibility follows SillyTavern's server policy. With exposure disabled, the
manager renders the native mask, does not copy it, and leaves the Key field
blank when editing. With exposure enabled, `/read` supplies the plaintext for
display, copy, and editing. The extension never writes returned values to
extension settings, browser storage, or logs.

The direct connect button is intercepted only when all of the following hold:

- the click is trusted user input;
- Main API is Chat Completion (`openai` internally);
- source is `custom`.

After a successful binding transaction, the extension produces an untrusted
programmatic click. That bypasses EasySwitch and runs the original handler with
the key input already cleared, preventing duplicate Secret creation.

## Compatibility surface

The context API does not expose Secret CRUD or a Secret-state refresh method.
Calling the existing Secrets HTTP endpoints is preferable to monkey-patching
core functions and keeps API keys server-managed. One internal import remains:
`/scripts/secrets.js::readSecretState()`, used only after an HTTP mutation to
refresh core's masked in-memory display. It is isolated in `compatibility.js`.

If that export changes, the binding itself still commits; only the native key
placeholder may be stale until reload. The compatibility layer logs a warning
without secret data.

## Transaction limits

`custom_url` and `secrets.json` are separate server writes and core exposes no
cross-store transaction. EasySwitch serializes its own operations, validates
before mutation, performs read-back verification with retries, and applies
compensating writes after definite failures. An unverified/uncertain mutation
is not blindly rolled back because the first mutation may have succeeded; the
popup remains open and tells the user to refresh.

This is stronger than the native UI can currently provide without a core
transaction endpoint or a Server Plugin. Plaintext exposure remains controlled
solely by SillyTavern's `allowKeysExposure` setting.
