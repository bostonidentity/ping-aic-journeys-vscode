/**
 * Pure URL helpers for AM base URLs (D41). Shared by `tenants/client-cache`
 * (building the http baseURL + client/strategy AM path) and the connection
 * form's on-prem Test Connection. No `vscode`/`axios` — string in, string out.
 */

const DEFAULT_AM_PATH = "/am";

/** Origin (scheme://host[:port]) of an AM base URL. A bare hostname (no scheme)
 * is assumed https. Any path component is dropped — the origin is the axios
 * baseURL, and the AM context path is appended separately by the client. */
export function amOrigin(baseUrl: string): string {
  const withScheme = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return withScheme;
  }
}

/** AM context path = the path component of the base URL (so a WAR deployed
 * under `/openam` works), trailing slash stripped, defaulting to `/am` when the
 * URL carries no path. */
export function amContextPath(baseUrl: string, fallback: string = DEFAULT_AM_PATH): string {
  try {
    const path = new URL(
      baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`,
    ).pathname.replace(/\/+$/, "");
    return path || fallback;
  } catch {
    return fallback;
  }
}
