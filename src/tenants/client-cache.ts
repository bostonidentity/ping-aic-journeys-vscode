import { makeOnpremAuthStrategy } from "../auth/onprem-strategy";
import { makePaicAuthStrategy } from "../auth/paic-strategy";
import type { AuthStrategy } from "../auth/strategy";
import type { Connection } from "../domain/types";
import { amContextPath, amOrigin } from "../paic/am-url";
import { type ClientCapabilities, makePaicClient, type PaicClient } from "../paic/client";
import { makeHttpClient } from "../paic/http";
import type { Logger } from "../util/logger";
import type { TenantsRegistry } from "./registry";

/** AM context path for a connection: `/am` for paic; for onprem, derived from
 * the base URL (so a WAR under `/openam` works). */
function contextPathFor(conn: Connection): string {
  return conn.kind === "onprem" ? amContextPath(conn.host) : "/am";
}

/** Platform-resource families available. PAIC cloud has IDM + IDC; a standalone
 * on-prem AM has neither (D41 audit), so those client methods short-circuit. */
function capabilitiesFor(conn: Connection): ClientCapabilities {
  const available = conn.kind !== "onprem";
  return { themes: available, emailTemplates: available, esvs: available };
}

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

    // The stored secret is the JWK (paic) or the admin password (onprem). Same
    // SecretStorage key, same getter — meaning depends on `conn.kind` (D41).
    const secret = await deps.registry.getJwk(host);
    if (!secret) {
      throw new Error(
        conn.kind === "onprem"
          ? `No credentials stored for ${host}. Edit the connection to set the admin password.`
          : `No credentials stored for ${host}. Edit the connection to set the service-account JWK.`,
      );
    }

    const amPath = contextPathFor(conn);
    const authStrategy: AuthStrategy =
      conn.kind === "onprem"
        ? makeOnpremAuthStrategy({
            host: conn.host,
            username: conn.username,
            password: secret,
            amPath,
            log: deps.log,
          })
        : makePaicAuthStrategy({ host: conn.host, saId: conn.saId, jwk: secret, log: deps.log });

    // baseURL = origin (not the path-bearing base URL) so the client's
    // `${amPath}/json/...` isn't duplicated; the client + strategy own the path.
    const http = makeHttpClient({ host: amOrigin(conn.host), log: deps.log, authStrategy });
    return makePaicClient({ http, log: deps.log, amPath, capabilities: capabilitiesFor(conn) });
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
