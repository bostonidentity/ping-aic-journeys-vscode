import type { Level } from "pino";
import * as vscode from "vscode";
import type { Connection } from "./domain/types";
import { type ClientCache, makeClientCache } from "./tenants/client-cache";
import { makeProductionDeps, makeTenantsRegistry, type TenantsRegistry } from "./tenants/registry";
import { type Logger, makeLogger } from "./util/logger";
import { openConnectionForm } from "./views/connection-form";
import type { PaicNode } from "./views/nodes/base";
import { ConnectionNode } from "./views/nodes/connection";
import { PaicTreeProvider } from "./views/paic-tree-provider";
import { InspectorPanel } from "./webview/inspector/panel";

const LOG_LEVEL_SETTING = "paicJourneys.logging.level";
const LOG_FILE_ENABLED_SETTING = "paicJourneys.logging.fileEnabled";

let log: Logger;
let registry: TenantsRegistry;
let clientCache: ClientCache;

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel("PAIC Journeys", { log: true });
  context.subscriptions.push(channel);

  const cfg = vscode.workspace.getConfiguration();
  log = makeLogger({
    storageUri: context.globalStorageUri,
    version: (context.extension.packageJSON as { version: string }).version,
    level: cfg.get<Level>(LOG_LEVEL_SETTING, "info"),
    fileEnabled: cfg.get<boolean>(LOG_FILE_ENABLED_SETTING, true),
    channel,
  });
  log.info({ event: "extension.activated" }, "Extension activated");

  registry = makeTenantsRegistry(makeProductionDeps(context), log);
  context.subscriptions.push(registry);

  clientCache = makeClientCache({ registry, log });
  context.subscriptions.push({ dispose: () => clientCache.dispose() });

  const provider = new PaicTreeProvider(() =>
    registry.list().map((c) => new ConnectionNode(c, clientCache, log)),
  );
  const treeView = vscode.window.createTreeView<PaicNode>("paicJourneys.connections", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  const inspector = new InspectorPanel({ context, cache: clientCache, log, treeView });
  context.subscriptions.push(inspector);

  context.subscriptions.push(
    treeView.onDidChangeSelection((ev) => {
      const node = ev.selection[0];
      if (node) void inspector.show(node);
    }),
  );

  // Cached clients for hosts that disappeared or whose JWK might have changed
  // must be evicted; simplest correct behavior is to drop everything visible
  // at the time of mutation and let the next expand re-mint.
  let priorHosts = registry.list().map((c) => c.host);
  context.subscriptions.push(
    registry.onDidChange(() => {
      for (const h of priorHosts) clientCache.drop(h);
      priorHosts = registry.list().map((c) => c.host);
      provider.reload();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("paicJourneys.refresh", () => {
      log.info({ event: "tree.refresh" }, "Refreshing tree");
      for (const h of priorHosts) clientCache.drop(h);
      provider.reload();
    }),

    vscode.commands.registerCommand("paicJourneys.openInspector", () => {
      log.info({ event: "inspector.open" }, "Opening inspector");
      inspector.reveal();
    }),

    vscode.commands.registerCommand("paicJourneys.refreshNode", (node: PaicNode) => {
      if (!node || typeof node.refresh !== "function") return;
      log.debug({ event: "tree.refreshNode", uid: node.uid }, "Refreshing tree node");
      node.refresh();
      provider.reload(node);
    }),

    vscode.commands.registerCommand("paicJourneys.addConnection", async () => {
      log.info({ event: "connection.add.start" }, "Opening Add Connection form");
      const r = await openConnectionForm(context, {
        mode: "add",
        existingHosts: registry.list().map((c) => c.host),
        log,
        getExistingJwk: (h) => registry.getJwk(h),
      });
      if (!r) {
        log.debug({ event: "connection.add.cancelled" }, "Add Connection cancelled");
        return;
      }
      if (!r.jwk) {
        log.warn(
          { event: "connection.add.invalid" },
          "JWK missing on save — form should have blocked",
        );
        vscode.window.showErrorMessage("JWK is required when adding a new connection.");
        return;
      }
      const conn: Connection = { host: r.host, saId: r.saId, name: r.name };
      await registry.add(conn, r.jwk);
      log.info({ event: "connection.add", host: conn.host, sa_id: conn.saId }, "Connection added");
    }),

    vscode.commands.registerCommand("paicJourneys.editConnection", async (item: ConnectionNode) => {
      const conn = item.connection;
      log.info({ event: "connection.edit.start", host: conn.host }, "Opening Edit Connection form");
      const r = await openConnectionForm(context, {
        mode: "edit",
        initial: { host: conn.host, saId: conn.saId, name: conn.name },
        existingHosts: registry.list().map((c) => c.host),
        log,
        getExistingJwk: (h) => registry.getJwk(h),
      });
      if (!r) {
        log.debug({ event: "connection.edit.cancelled" }, "Edit Connection cancelled");
        return;
      }
      const updated: Connection = { host: r.host, saId: r.saId, name: r.name };
      await registry.update(conn.host, updated, r.jwk);
      log.info({ event: "connection.edit", host: updated.host }, "Connection updated");
    }),

    vscode.commands.registerCommand(
      "paicJourneys.removeConnection",
      async (item: ConnectionNode) => {
        const conn = item.connection;
        log.info(
          { event: "connection.remove.confirm", host: conn.host },
          "Confirming connection removal",
        );
        const choice = await vscode.window.showQuickPick(["YES", "NO"], {
          placeHolder: `Are you sure you want to remove connection "${conn.name || conn.host}"?`,
        });
        if (choice !== "YES") {
          log.debug({ event: "connection.remove.cancelled" }, "Remove Connection cancelled");
          return;
        }
        await registry.remove(conn.host);
        log.info({ event: "connection.remove", host: conn.host }, "Connection removed");
      },
    ),
  );
}

export function deactivate(): void {
  // nothing to clean up — disposables are managed via context.subscriptions
}
