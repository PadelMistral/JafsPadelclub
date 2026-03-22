/**
 * js/modules/path-utils.js
 * Centralized path detection for GitHub Pages and local environments.
 */

export function getAppBase() {
    const pathname = String(window.location.pathname || "/");
    const segments = pathname.split("/").filter(Boolean);
    if (!segments.length) return "/";

    const last = segments[segments.length - 1] || "";
    const hasFile = /\.[a-z0-9]+$/i.test(last);
    const baseSegments = hasFile ? segments.slice(0, -1) : segments;
    if (!baseSegments.length) return "/";

    // GitHub Pages and local subfolder hosting both work with the same base rule:
    // use the directory that contains the current page.
    return `/${baseSegments.join("/")}/`;
}

export function getFullUrl(relativePath) {
    const base = getAppBase();
    const cleanRelative = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    return base + cleanRelative;
}
