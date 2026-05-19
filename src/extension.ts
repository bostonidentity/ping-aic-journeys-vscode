import type { Level } from "pino";
import * as vscode from "vscode";
import type { Connection } from "./domain/types";
import {
  EMAIL_TEMPLATE_URI_SCHEME,
  makeEmailTemplateUri,
  PaicEmailTemplateFileSystemProvider,
} from "./providers/email-template-fs-provider";
import {
  makeScriptUri,
  PaicScriptFileSystemProvider,
  SCRIPT_URI_SCHEME,
} from "./providers/script-fs-provider";
import { type ClientCache, makeClientCache } from "./tenants/client-cache";
import { makeProductionDeps, makeTenantsRegistry, type TenantsRegistry } from "./tenants/registry";
import { type Logger, makeLogger } from "./util/logger";
import { MessageNode, type PaicNode } from "./views/nodes/base";
import { CategoryHeaderNode } from "./views/nodes/category-header";
import { ConnectionNode } from "./views/nodes/connection";
import { LibraryScriptNode } from "./views/nodes/library-script";
import { ScriptNode } from "./views/nodes/script";
import { PaicTreeProvider } from "./views/paic-tree-provider";
import { openConnectionForm } from "./webview/connection-form/panel";
import { InspectorFactory } from "./webview/inspector/panel";

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

  // Per D24, every "show a card" gesture (tree click, card hyperlink click,
  // diagram node click) spawns a fresh inspector tab via the factory — no
  // reuse, no in-place updates.
  const inspectorFactory = new InspectorFactory({ context, cache: clientCache, log });
  context.subscriptions.push(inspectorFactory);

  // Register the FileSystemProvider that surfaces script bodies as
  // `paic-script://<host>/<realm>/<scriptId>.<ext>` editor tabs (D17).
  const scriptFs = new PaicScriptFileSystemProvider(clientCache, log);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SCRIPT_URI_SCHEME, scriptFs, {
      isReadonly: true,
      isCaseSensitive: true,
    }),
  );

  // Same pattern for email-template bodies — `paic-email-template://<host>/<name>/<locale>.html`.
  const emailTemplateFs = new PaicEmailTemplateFileSystemProvider(clientCache, log);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(EMAIL_TEMPLATE_URI_SCHEME, emailTemplateFs, {
      isReadonly: true,
      isCaseSensitive: true,
    }),
  );

  context.subscriptions.push(
    treeView.onDidChangeSelection((ev) => {
      const node = ev.selection[0];
      if (!node) return;
      // Category headers and message rows aren't data nodes — clicking them
      // shouldn't spawn an inspector tab (D33).
      if (node instanceof CategoryHeaderNode) return;
      if (node instanceof MessageNode) return;
      inspectorFactory.spawn(node);
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
      inspectorFactory.clearRegistry();
      provider.reload();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("paicJourneys.refresh", () => {
      log.info({ event: "tree.refresh" }, "Refreshing tree");
      for (const h of priorHosts) clientCache.drop(h);
      inspectorFactory.clearRegistry();
      provider.reload();
    }),

    vscode.commands.registerCommand("paicJourneys.openEmailTemplateBody", async (arg: unknown) => {
      const parsed = parseOpenEmailTemplateArg(arg);
      if (!parsed) {
        log.warn(
          { event: "openEmailTemplateBody.badArg" },
          "openEmailTemplateBody invoked without host / name / locale",
        );
        return;
      }
      const uri = makeEmailTemplateUri(parsed.host, parsed.name, parsed.locale);
      log.info(
        {
          event: "openEmailTemplateBody",
          host: parsed.host,
          template_name: parsed.name,
          locale: parsed.locale,
        },
        "Opening email-template body in editor",
      );
      await vscode.commands.executeCommand("vscode.open", uri, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside,
      });
    }),

    vscode.commands.registerCommand("paicJourneys.openScriptBody", async (arg: unknown) => {
      const parsed = parseOpenScriptArg(arg);
      if (!parsed) {
        log.warn(
          { event: "openScriptBody.badArg" },
          "openScriptBody invoked without host / realm / scriptId",
        );
        return;
      }
      const uri = makeScriptUri(parsed.host, parsed.realm, parsed.scriptId, parsed.language);
      log.info(
        {
          event: "openScriptBody",
          host: parsed.host,
          realm: parsed.realm,
          script_id: parsed.scriptId,
        },
        "Opening script body in editor",
      );
      await vscode.commands.executeCommand("vscode.open", uri, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside,
      });
    }),

    vscode.commands.registerCommand(
      "paicJourneys.diffScriptAcrossConnections",
      async (arg: unknown) => {
        const parsed = parseOpenScriptArg(arg);
        if (!parsed) {
          log.warn(
            { event: "diffScript.badArg" },
            "diffScriptAcrossConnections invoked without host / realm / scriptId",
          );
          return;
        }
        const others = registry.list().filter((c) => c.host !== parsed.host);
        if (others.length === 0) {
          vscode.window.showInformationMessage(
            "No other connections to diff against. Add a second connection in the PAIC Journeys sidebar.",
          );
          return;
        }
        let peer = others[0];
        if (others.length > 1) {
          const pick = await vscode.window.showQuickPick(
            others.map((c) => ({
              label: c.name ?? c.host,
              description: c.host,
              host: c.host,
            })),
            { placeHolder: `Diff "${parsed.scriptId}" with which connection?` },
          );
          if (!pick) return;
          peer = others.find((c) => c.host === pick.host) ?? peer;
        }
        const left = makeScriptUri(parsed.host, parsed.realm, parsed.scriptId, parsed.language);
        const right = makeScriptUri(peer.host, parsed.realm, parsed.scriptId, parsed.language);
        const title = `Script Diff: ${parsed.host} ↔ ${peer.host} · ${parsed.scriptId}`;
        log.info(
          {
            event: "diffScript",
            host_left: parsed.host,
            host_right: peer.host,
            realm: parsed.realm,
            script_id: parsed.scriptId,
          },
          "Opening cross-tenant script diff",
        );
        await vscode.commands.executeCommand("vscode.diff", left, right, title);
      },
    ),

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

interface OpenScriptArgs {
  host: string;
  realm: string;
  scriptId: string;
  language?: string;
}

/** Accepts a `ScriptNode` or `LibraryScriptNode` (tree right-click handed
 * us the tree item) or a plain `{host, realm, scriptId, language?}` payload
 * (from an inspector card's `openScriptBody` message). Both node kinds carry
 * the same `host` / `realm` / `scriptId` fields, so the FS provider serves
 * the body identically. */
function parseOpenScriptArg(arg: unknown): OpenScriptArgs | null {
  if (arg instanceof ScriptNode || arg instanceof LibraryScriptNode) {
    const language = arg.resolved?.language;
    return { host: arg.host, realm: arg.realm, scriptId: arg.scriptId, language };
  }
  if (arg && typeof arg === "object") {
    const a = arg as Record<string, unknown>;
    if (
      typeof a.host === "string" &&
      typeof a.realm === "string" &&
      typeof a.scriptId === "string"
    ) {
      return {
        host: a.host,
        realm: a.realm,
        scriptId: a.scriptId,
        language: typeof a.language === "string" ? a.language : undefined,
      };
    }
  }
  return null;
}

interface OpenEmailTemplateArgs {
  host: string;
  name: string;
  locale: string;
}

/** Accepts `{host, name, locale}` from either a tree-context invocation or
 * an inspector-card button click. (No tree-side EmailTemplateNode binding
 * because email templates are not bound to a specific locale at tree level
 * — locale is picked at the card.) */
function parseOpenEmailTemplateArg(arg: unknown): OpenEmailTemplateArgs | null {
  if (arg && typeof arg === "object") {
    const a = arg as Record<string, unknown>;
    if (typeof a.host === "string" && typeof a.name === "string" && typeof a.locale === "string") {
      return { host: a.host, name: a.name, locale: a.locale };
    }
  }
  return null;
}
