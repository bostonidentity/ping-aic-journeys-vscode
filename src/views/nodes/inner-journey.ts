import * as vscode from "vscode";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { PaicNode } from "./base";
import { expandInnerJourney } from "./journey-expand";

/**
 * An inner-journey reference. Same expansion shape as a top-level journey,
 * but threaded with a visited-ancestor list for cycle detection (per D7).
 */
export class InnerJourneyNode extends PaicNode {
  readonly uid: string;
  constructor(
    public readonly host: string,
    public readonly realm: string,
    public readonly id: string,
    private readonly cache: ClientCache,
    private readonly log: Logger,
    public readonly visited: readonly string[],
    parent?: PaicNode,
  ) {
    super(id, vscode.TreeItemCollapsibleState.Collapsed);
    this.parent = parent;
    this.uid = `inner:${host}:${realm}:${id}:${visited.join(",")}`;
    this.contextValue = "innerJourney";
    this.iconPath = new vscode.ThemeIcon("type-hierarchy-sub");
    this.tooltip = `Inner journey "${id}" in realm ${realm}`;
  }

  protected loadChildren(): Promise<PaicNode[]> {
    return expandInnerJourney({
      host: this.host,
      realm: this.realm,
      id: this.id,
      visited: this.visited,
      cache: this.cache,
      log: this.log,
      parent: this,
    });
  }
}
