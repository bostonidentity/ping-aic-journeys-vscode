import type { Logger } from "../util/logger";
import type { AuthStrategy } from "./strategy";

export interface OnpremAuthStrategyOptions {
  /** AM base/origin URL, e.g. `http://openam.example.com:8080`. */
  host: string;
  username: string;
  /** Admin password (the SecretStorage value for an onprem connection). */
  password: string;
  log: Logger;
  /** AM context-path prefix (default `/am`; on-prem WARs may use a custom path,
   * derived from the connection base URL by `client-cache` — D41 Slice 3). */
  amPath?: string;
  /** Injected fetch — tests supply a mock. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_AM_PATH = "/am";
const SERVERINFO_API_VERSION = "resource=1.1,protocol=1.0";
const AUTHENTICATE_API_VERSION = "resource=2.0,protocol=1.0";

/**
 * On-prem PingAM auth strategy: authenticates with admin username/password to
 * obtain an SSO session `tokenId`, presented as `Cookie: <cookieName>=<tokenId>`.
 * The cookie name is per-deployment and discovered via `serverinfo` (never
 * hardcode `iPlanetDirectoryPro` — lesson 2026-05-15). `fetch`-based: this runs
 * before the authenticated HTTP client exists, mirroring `paic/auth.ts`.
 *
 * AM sessions carry no `expires_in`, so there is no proactive TTL — re-auth is
 * driven by the transport's 401 self-heal calling `getAuthHeaders({forceRefresh})`.
 */
export function makeOnpremAuthStrategy(opts: OnpremAuthStrategyOptions): AuthStrategy {
  const log = opts.log.child({ component: "auth.onprem" });
  const fetchFn = opts.fetchImpl ?? fetch;
  const amPath = opts.amPath ?? DEFAULT_AM_PATH;
  const origin = new URL(opts.host.startsWith("http") ? opts.host : `https://${opts.host}`).origin;

  // The cookie name is stable across session refreshes — discover once, cache.
  let cookieName: string | null = null;
  let session: { cookieName: string; tokenId: string } | null = null;

  async function discoverCookieName(): Promise<string> {
    if (cookieName) return cookieName;
    const resp = await fetchFn(`${origin}${amPath}/json/serverinfo/*`, {
      headers: { "Accept-API-Version": SERVERINFO_API_VERSION },
    });
    const parsed = await readJson(resp);
    const name = typeof parsed.cookieName === "string" ? parsed.cookieName : undefined;
    if (!resp.ok || !name) {
      throw new Error(`Could not discover AM cookie name (HTTP ${resp.status}).`);
    }
    cookieName = name;
    log.debug(
      { event: "auth.onprem.cookieName", host: opts.host },
      "Discovered AM session cookie name",
    );
    return name;
  }

  async function authenticate(): Promise<{ cookieName: string; tokenId: string }> {
    const name = await discoverCookieName();
    log.debug({ event: "auth.onprem.authenticate.start", host: opts.host }, "Authenticating to AM");
    const resp = await fetchFn(`${origin}${amPath}/json/realms/root/authenticate`, {
      method: "POST",
      headers: {
        "X-OpenAM-Username": opts.username,
        "X-OpenAM-Password": opts.password,
        "Content-Type": "application/json",
        "Accept-API-Version": AUTHENTICATE_API_VERSION,
      },
      body: "{}",
    });
    const parsed = await readJson(resp);
    const tokenId = typeof parsed.tokenId === "string" ? parsed.tokenId : undefined;
    if (!resp.ok || !tokenId) {
      // Never include credentials or the response body in the message.
      throw new Error(`AM authentication failed (HTTP ${resp.status}).`);
    }
    log.debug(
      { event: "auth.onprem.authenticate.done", host: opts.host },
      "AM session established",
    );
    session = { cookieName: name, tokenId };
    return session;
  }

  return {
    async getAuthHeaders(o) {
      const s = o?.forceRefresh === true || !session ? await authenticate() : session;
      return { Cookie: `${s.cookieName}=${s.tokenId}` };
    },
  };
}

async function readJson(resp: Response): Promise<Record<string, unknown>> {
  const text = await resp.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
