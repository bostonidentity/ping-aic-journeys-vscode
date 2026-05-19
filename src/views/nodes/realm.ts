import * as vscode from "vscode";
import type { Realm } from "../../domain/types";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { MessageNode, PaicNode } from "./base";
import { JourneyNode } from "./journey";

/** A realm under a connection. Lists journeys via `client.listJourneys`. */
export class RealmNode extends PaicNode {
  readonly uid: string;
  constructor(
    public readonly host: string,
    public readonly realm: Realm,
    private readonly cache: ClientCache,
    private readonly log: Logger,
    parent?: PaicNode,
  ) {
    super(realm.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.parent = parent;
    this.uid = `realm:${host}:${realm.name}`;
    this.id = this.uid;
    this.description = realm.active ? undefined : "(inactive)";
    this.tooltip = buildRealmTooltip(host, realm);
    this.contextValue = "realm";
    this.iconPath = new vscode.ThemeIcon("globe");
  }

  protected async loadChildren(): Promise<PaicNode[]> {
    const client = await this.cache.get(this.host);
    const journeys = await client.listJourneys(this.realm.name);
    if (journeys.length === 0) {
      return [new MessageNode("No journeys in this realm", "info")];
    }
    // Single-kind level → no category header, but still sort alphabetically
    // by id for predictable scanning (D33 principle).
    const sorted = [...journeys].sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { sensitivity: "base" }),
    );
    return sorted.map(
      (j) => new JourneyNode(this.host, this.realm.name, j, this.cache, this.log, [], this),
    );
  }
}

function buildRealmTooltip(host: string, realm: Realm): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`### Realm: \`${realm.name}\`\n\n`);
  md.appendMarkdown(`**Host:** \`${host}\`\n\n`);
  md.appendMarkdown(`**Parent path:** \`${realm.parentPath}\`\n\n`);
  md.appendMarkdown(`**Status:** ${realm.active ? "Active" : "Inactive"}\n`);
  return md;
}
