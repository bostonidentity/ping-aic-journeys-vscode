import * as vscode from "vscode";
import { openConnectionForm } from "./views/connection-form";

interface Connection {
  host: string;
  saId: string;
  name?: string;
}

const SETTINGS_KEY = "aicJourneys.connections";
const SECRET_PREFIX = "aicJourneys.saJwk.";

// ---------- logging ----------

let log: vscode.LogOutputChannel;

// ---------- storage ----------

function list(): Connection[] {
  return vscode.workspace.getConfiguration().get<Connection[]>(SETTINGS_KEY, []);
}

async function persist(conns: Connection[]): Promise<void> {
  const target = vscode.workspace.workspaceFolders
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration().update(SETTINGS_KEY, conns, target);
}

// ---------- tree view ----------

class ConnectionsProvider implements vscode.TreeDataProvider<Connection> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire();
  }

  getChildren(): Connection[] {
    return list();
  }

  getTreeItem(c: Connection): vscode.TreeItem {
    const item = new vscode.TreeItem(c.name || c.host);
    item.description = c.name ? c.host : undefined;
    item.tooltip = `${c.host}\nsaId: ${c.saId}`;
    item.contextValue = "connection";
    item.iconPath = new vscode.ThemeIcon("plug");
    return item;
  }
}

// ---------- commands ----------

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel("AIC Journeys", { log: true });
  context.subscriptions.push(log);
  log.info("Extension activated");

  const provider = new ConnectionsProvider();
  vscode.window.registerTreeDataProvider("aicJourneys.connections", provider);

  context.subscriptions.push(
    vscode.commands.registerCommand("aicJourneys.addConnection", async () => {
      log.info("addConnection: opening form");
      const conns = list();
      const r = await openConnectionForm(context, {
        mode: "add",
        existingHosts: conns.map((c) => c.host),
        log,
      });
      if (!r) {
        log.debug("addConnection: cancelled");
        return;
      }
      if (!r.jwk) {
        log.warn("addConnection: missing jwk on save (form should have blocked)");
        vscode.window.showErrorMessage("JWK is required when adding a new connection.");
        return;
      }
      const conn: Connection = { host: r.host, saId: r.saId, name: r.name };
      await persist([...conns, conn]);
      await context.secrets.store(SECRET_PREFIX + conn.host, r.jwk);
      log.info(`addConnection: added "${conn.host}" (saId=${conn.saId})`);
      provider.refresh();
    }),

    vscode.commands.registerCommand("aicJourneys.editConnection", async (item: Connection) => {
      log.info(`editConnection: opening form for "${item.host}"`);
      const conns = list();
      const r = await openConnectionForm(context, {
        mode: "edit",
        initial: { host: item.host, saId: item.saId, name: item.name },
        existingHosts: conns.map((c) => c.host),
        log,
      });
      if (!r) {
        log.debug("editConnection: cancelled");
        return;
      }
      const updated: Connection = { host: r.host, saId: r.saId, name: r.name };
      await persist(conns.map((c) => (c.host === item.host ? updated : c)));
      if (item.host !== updated.host) {
        const oldSecret = await context.secrets.get(SECRET_PREFIX + item.host);
        if (oldSecret !== undefined && !r.jwk) {
          await context.secrets.store(SECRET_PREFIX + updated.host, oldSecret);
        }
        await context.secrets.delete(SECRET_PREFIX + item.host);
        log.debug(`editConnection: host renamed ${item.host} -> ${updated.host}`);
      }
      if (r.jwk) {
        await context.secrets.store(SECRET_PREFIX + updated.host, r.jwk);
      }
      log.info(`editConnection: updated "${updated.host}"`);
      provider.refresh();
    }),

    vscode.commands.registerCommand("aicJourneys.removeConnection", async (item: Connection) => {
      log.info(`removeConnection: confirming "${item.host}"`);
      const ok = await vscode.window.showWarningMessage(
        `Remove connection "${item.name || item.host}"?`,
        { modal: true },
        "Remove",
      );
      if (ok !== "Remove") {
        log.debug("removeConnection: cancelled");
        return;
      }
      await persist(list().filter((c) => c.host !== item.host));
      await context.secrets.delete(SECRET_PREFIX + item.host);
      log.info(`removeConnection: removed "${item.host}"`);
      provider.refresh();
    }),
  );
}

export function deactivate(): void {
  // nothing to clean up — disposables are managed via context.subscriptions
}
