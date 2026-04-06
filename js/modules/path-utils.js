/**
 * js/modules/path-utils.js
 * Centralized path detection for GitHub Pages and local environments.
 */

export function getAppBase() {
    const p = window.location.pathname;
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');

    if (isLocal) return '/';

    // For GitHub Pages: https://user.github.io/repo-name/index.html
    // pathname: /repo-name/index.html -> segments: ["repo-name", "index.html"]
    const segments = p.split('/').filter(Boolean);
    
    // If we have at least one segment and it doesn't look like a file (no dot)
    if (segments.length > 0 && !segments[0].includes('.')) {
        return `/${segments[0]}/`;
    }

    return '/';
}

export function getFullUrl(relativePath) {
    const base = getAppBase();
    const cleanRelative = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    return base + cleanRelative;
}
