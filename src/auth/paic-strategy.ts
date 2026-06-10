import { mintToken } from "../paic/auth";
import type { Logger } from "../util/logger";
import type { AuthStrategy } from "./strategy";

export interface PaicAuthStrategyOptions {
  host: string;
  saId: string;
  /** The service-account JWK JSON string (the SecretStorage value for a paic connection). */
  jwk: string;
  log: Logger;
  /** Injected fetch — forwarded to `mintToken`; tests supply a mock. */
  fetchImpl?: typeof fetch;
}

// 30 s safety margin matches frodo-lib (`TokenCacheOps.readToken`). Anything
// that slips past is caught by the transport's 401 self-heal.
const TOKEN_REFRESH_MARGIN_MS = 30_000;

/**
 * PAIC cloud auth strategy: mints a service-account JWT-bearer access token and
 * presents it as `Authorization: Bearer`. Owns the in-memory token cache
 * (lifted out of `tenants/client-cache.ts` per D41).
 */
export function makePaicAuthStrategy(opts: PaicAuthStrategyOptions): AuthStrategy {
  const log = opts.log.child({ component: "auth.paic" });
  let cached: { token: string; expiresAt: number } | null = null;

  async function token(forceRefresh: boolean): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && cached && cached.expiresAt > now + TOKEN_REFRESH_MARGIN_MS) {
      log.trace({ event: "auth.paic.cacheHit", host: opts.host }, "Reusing cached bearer token");
      return cached.token;
    }
    log.debug({ event: "auth.paic.mint.start", host: opts.host }, "Minting service-account token");
    const res = await mintToken({
      host: opts.host,
      saId: opts.saId,
      jwk: opts.jwk,
      fetchImpl: opts.fetchImpl,
    });
    if (!res.ok) throw new Error(`Token mint failed: ${res.message}`);
    cached = { token: res.accessToken, expiresAt: Date.now() + res.expiresIn * 1000 };
    log.debug({ event: "auth.paic.mint.done", host: opts.host }, "Minted service-account token");
    return cached.token;
  }

  return {
    async getAuthHeaders(o) {
      return { Authorization: `Bearer ${await token(o?.forceRefresh === true)}` };
    },
  };
}
