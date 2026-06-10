import * as vscode from "vscode";
import { type Connection, normalizeConnection } from "../domain/types";
import type { Logger } from "../util/logger";

const SETTINGS_KEY = "paicJourneys.connections";
const SECRET_PREFIX = "paicJourneys.saJwk.";

/**
 * The narrow contract the registry needs from VS Code. Injected so tests can
 * supply in-memory fakes without `vi.mock("vscode")`. Production wires real
 * `vscode.workspace.getConfiguration()` / `context.secrets` via
 * `makeProductionDeps()` below.
 */
export interface TenantsRegistryDeps {
  config: {
    get(): Connection[];
    set(value: Connection[]): Thenable<void>;
  };
  secrets: {
    get(key: string): Thenable<string | undefined>;
    store(key: string, value: string): Thenable<void>;
    delete(key: string): Thenable<void>;
  };
}

export interface TenantsRegistry extends vscode.Disposable {
  list(): Connection[];
  add(conn: Connection, jwk: string): Promise<void>;
  /**
   * Update an existing connection. If `newConn.host !== oldHost`, moves the
   * stored secret to the new key. If `newJwk` is provided it replaces the
   * stored JWK; otherwise the existing JWK survives the rename.
   */
  update(oldHost: string, newConn: Connection, newJwk?: string): Promise<void>;
  remove(host: string): Promise<void>;
  /** Read the JWK for a host. Returns undefined if not stored. */
  getJwk(host: string): Thenable<string | undefined>;
  /** Fires after any mutation that changes the list. */
  readonly onDidChange: vscode.Event<void>;
}

/**
 * Build a tenant registry. Pure logic; the only `vscode` dependency is
 * `EventEmitter`, which production tests mock via `tests/util/vscode-mock.ts`.
 */
export function makeTenantsRegistry(deps: TenantsRegistryDeps, log: Logger): TenantsRegistry {
  const childLog = log.child({ component: "tenants.registry" });
  const emitter = new vscode.EventEmitter<void>();
  const secretKey = (host: string) => SECRET_PREFIX + host;

  const registry: TenantsRegistry = {
    // Normalize legacy configs (no `kind`) → paic at the read boundary so the
    // rest of the code always sees a proper discriminated union (D41).
    list: () => deps.config.get().map(normalizeConnection),

    async add(conn, jwk) {
      const current = deps.config.get();
      await deps.config.set([...current, conn]);
      await deps.secrets.store(secretKey(conn.host), jwk);
      childLog.info({ event: "tenant.add", host: conn.host }, "Tenant added");
      emitter.fire();
    },

    async update(oldHost, newConn, newJwk) {
      const current = deps.config.get();
      await deps.config.set(current.map((c) => (c.host === oldHost ? newConn : c)));

      if (oldHost !== newConn.host) {
        const oldSecret = await deps.secrets.get(secretKey(oldHost));
        if (oldSecret !== undefined && !newJwk) {
          await deps.secrets.store(secretKey(newConn.host), oldSecret);
        }
        await deps.secrets.delete(secretKey(oldHost));
        childLog.debug(
          { event: "tenant.rename", from: oldHost, to: newConn.host },
          "Renamed host — secret moved",
        );
      }
      if (newJwk) {
        await deps.secrets.store(secretKey(newConn.host), newJwk);
      }

      childLog.info({ event: "tenant.update", host: newConn.host }, "Tenant updated");
      emitter.fire();
    },

    async remove(host) {
      const current = deps.config.get();
      await deps.config.set(current.filter((c) => c.host !== host));
      await deps.secrets.delete(secretKey(host));
      childLog.info({ event: "tenant.remove", host }, "Tenant removed");
      emitter.fire();
    },

    getJwk: (host) => deps.secrets.get(secretKey(host)),
    onDidChange: emitter.event,
    dispose: () => emitter.dispose(),
  };

  return registry;
}

/**
 * Wire `vscode.workspace` + `context.secrets` into the registry's
 * `TenantsRegistryDeps` shape. Called from `extension.ts:activate()`.
 */
export function makeProductionDeps(context: vscode.ExtensionContext): TenantsRegistryDeps {
  return {
    config: {
      // Connections are per-user credentials, never per-project. Read and write
      // Global only — workspace-level entries (whether from an old version of
      // this extension or a hand-edit) are deliberately ignored. The setting
      // is also declared with `"scope": "application"` in package.json so VS
      // Code itself refuses workspace overrides.
      get: () =>
        vscode.workspace.getConfiguration().inspect<Connection[]>(SETTINGS_KEY)?.globalValue ?? [],
      set: (value) =>
        vscode.workspace
          .getConfiguration()
          .update(SETTINGS_KEY, value, vscode.ConfigurationTarget.Global),
    },
    secrets: context.secrets,
  };
}
