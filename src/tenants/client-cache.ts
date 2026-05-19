import { mintToken } from "../paic/auth";
import { makePaicClient, type PaicClient } from "../paic/client";
import { makeHttpClient } from "../paic/http";
import type { Logger } from "../util/logger";
import type { TenantsRegistry } from "./registry";

/**
 * One `PaicClient` per connection host, lazily minted on first use. Each
 * client carries its own in-memory bearer-token cache (inside the `getToken`
 * closure passed to `makeHttpClient`), so repeated calls don't pay for token
 * mints. Clients are dropped when the registry changes — see
 * `extension.ts:activate` which subscribes to `registry.onDidChange`.
 */
export interface ClientCache {
  /** Mint a client for a host, or return the cached one. Throws if the
   * connection isn't in the registry or the JWK isn't in SecretStorage. */
  get(host: string): Promise<PaicClient>;
  /** Evict a cached client. Next `get(host)` will mint fresh. */
  drop(host: string): void;
  /** Clear the entire cache. Called on extension deactivate. */
  dispose(): void;
}

export interface ClientCacheDeps {
  registry: TenantsRegistry;
  log: Logger;
}

export function makeClientCache(deps: ClientCacheDeps): ClientCache {
  const log = deps.log.child({ component: "tenants.clientCache" });
  const clients = new Map<string, PaicClient>();

  async function build(host: string): Promise<PaicClient> {
    const conn = deps.registry.list().find((c) => c.host === host);
    if (!conn) throw new Error(`Connection not found: ${host}`);
    const jwk = await deps.registry.getJwk(host);
    if (!jwk) {
      throw new Error(
        `No credentials stored for ${host}. Edit the connection to set the service-account JWK.`,
      );
    }

    let cached: { token: string; expiresAt: number } | null = null;
    const getToken = async (opts?: { forceRefresh?: boolean }): Promise<string> => {
      const now = Date.now();
      // 30 s safety margin matches frodo-lib (`TokenCacheOps.readToken`).
      // The 401 self-heal in `paic/http.ts` catches anything that slips past.
      if (!opts?.forceRefresh && cached && cached.expiresAt > now + 30_000) {
        return cached.token;
      }
      const res = await mintToken({ host: conn.host, saId: conn.saId, jwk });
      if (!res.ok) throw new Error(`Token mint failed: ${res.message}`);
      cached = {
        token: res.accessToken,
        expiresAt: Date.now() + res.expiresIn * 1000,
      };
      return cached.token;
    };

    const http = makeHttpClient({ host: conn.host, log: deps.log, getToken });
    return makePaicClient({ http, log: deps.log });
  }

  return {
    async get(host) {
      const hit = clients.get(host);
      if (hit) return hit;
      const built = await build(host);
      clients.set(host, built);
      log.debug({ event: "client.mint", host }, "Built PAIC client for host");
      return built;
    },
    drop(host) {
      if (clients.delete(host)) {
        log.debug({ event: "client.drop", host }, "Dropped cached PAIC client");
      }
    },
    dispose() {
      clients.clear();
    },
  };
}
