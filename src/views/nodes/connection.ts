import * as vscode from "vscode";
import type { Connection } from "../../domain/types";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { MessageNode, PaicNode } from "./base";
import { RealmNode } from "./realm";

/** A persisted PAIC connection. First-class L1 tree item. */
export class ConnectionNode extends PaicNode {
  readonly uid: string;
  constructor(
    public readonly connection: Connection,
    private readonly cache: ClientCache,
    private readonly log: Logger,
    parent?: PaicNode,
  ) {
    super(connection.name || connection.host, vscode.TreeItemCollapsibleState.Collapsed);
    this.parent = parent;
    this.uid = `connection:${connection.host}`;
    this.description = connection.name ? connection.host : undefined;
    this.tooltip = `${connection.host}\nsaId: ${connection.saId}`;
    this.contextValue = "connection";
    this.iconPath = new vscode.ThemeIcon("plug");
  }

  protected async loadChildren(): Promise<PaicNode[]> {
    const client = await this.cache.get(this.connection.host);
    const realms = await client.listRealms();
    if (realms.length === 0) {
      return [new MessageNode("No realms found", "info")];
    }
    return realms.map((r) => new RealmNode(this.connection.host, r, this.cache, this.log, this));
  }
}
