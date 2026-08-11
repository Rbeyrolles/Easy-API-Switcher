/**
 * Trims an endpoint without otherwise changing its path or trailing slash.
 * SillyTavern passes the configured string through to the Custom backend, so
 * this extension deliberately avoids opinionated URL canonicalization.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function cleanEndpoint(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Returns true only for an HTTP(S) Base URL that is safe to store as a visible
 * Secret label. Userinfo is rejected because labels are non-secret metadata.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBindableEndpoint(value) {
    const endpoint = cleanEndpoint(value);
    if (!endpoint) {
        return false;
    }

    try {
        const url = new URL(endpoint);
        return (url.protocol === 'http:' || url.protocol === 'https:')
            && Boolean(url.hostname)
            && !url.username
            && !url.password;
    } catch {
        return false;
    }
}

/**
 * Compares endpoints without rewriting the value saved by SillyTavern.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function endpointsEqual(left, right) {
    const a = cleanEndpoint(left);
    const b = cleanEndpoint(right);
    if (a === b) {
        return true;
    }

    try {
        return new URL(a).href === new URL(b).href;
    } catch {
        return false;
    }
}
