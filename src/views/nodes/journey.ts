import * as vscode from "vscode";
import type { Journey } from "../../domain/types";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { PaicNode } from "./base";
import { expandJourney } from "./journey-expand";

/**
 * A journey (tree). Carries the full skeleton (returned inline by
 * `listJourneys`), so expansion just needs per-node payload fetches.
 */
export class JourneyNode extends PaicNode {
  readonly uid: string;
  constructor(
    public readonly host: string,
    public readonly realm: string,
    public readonly journey: Journey,
    private readonly cache: ClientCache,
    private readonly log: Logger,
    public readonly visited: readonly string[] = [],
    parent?: PaicNode,
  ) {
    super(journey.id, vscode.TreeItemCollapsibleState.Collapsed);
    this.parent = parent;
    this.uid = `journey:${host}:${realm}:${journey.id}`;
    this.description = journey.enabled ? undefined : "(disabled)";
    this.tooltip = journey.description ?? `Journey ${journey.id}`;
    this.contextValue = "journey";
    this.iconPath = new vscode.ThemeIcon("symbol-class");
  }

  protected loadChildren(): Promise<PaicNode[]> {
    return expandJourney({
      host: this.host,
      realm: this.realm,
      journey: this.journey,
      visited: this.visited,
      cache: this.cache,
      log: this.log,
      parent: this,
    });
  }
}
