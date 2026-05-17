import * as vscode from "vscode";
import type { Journey, NodePayload } from "../../domain/types";
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
  /** Populated by `expandJourney` after fetching per-node payloads (see
   * `JourneyNode.payloadsByNodeId` for the rationale). */
  payloadsByNodeId?: ReadonlyMap<string, NodePayload>;

  /** Shared promise for the journey-skeleton fetch — see `ensureJourney`. */
  private journeyPromise?: Promise<Journey>;

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
    // NOTE: we deliberately do NOT set `this.id = this.uid` here. The
    // constructor's `id` parameter is the AIC inner-journey id (e.g.
    // "PasswordReset") and shadows TreeItem's `id`; overwriting it would
    // break the `node.id` domain accessor everywhere. Collapse-state
    // persistence on inner-journey rows is a nice-to-have, not a must-have.
    this.contextValue = "innerJourney";
    this.iconPath = new vscode.ThemeIcon("type-hierarchy-sub");
    this.tooltip = buildInnerJourneyTooltip(host, realm, id, visited);
  }

  /**
   * Lazy-fetch the inner journey's full skeleton from PAIC. Shared by the
   * inspector (which needs the skeleton to render the diagram) and by
   * `expandInnerJourney` during tree expansion (which needs it to fetch
   * node payloads). Concurrent callers get the same in-flight Promise; a
   * fetch failure clears the cache so a subsequent call retries.
   */
  ensureJourney(): Promise<Journey> {
    if (!this.journeyPromise) {
      this.journeyPromise = this.fetchJourney().catch((err) => {
        this.journeyPromise = undefined;
        throw err;
      });
    }
    return this.journeyPromise;
  }

  private async fetchJourney(): Promise<Journey> {
    const client = await this.cache.get(this.host);
    return client.getJourney(this.realm, this.id);
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

function buildInnerJourneyTooltip(
  host: string,
  realm: string,
  id: string,
  visited: readonly string[],
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`### Inner journey: \`${id}\`\n\n`);
  md.appendMarkdown(`**Host:** \`${host}\` · **Realm:** \`${realm}\`\n\n`);
  if (visited.length > 0) {
    md.appendMarkdown(`**Ancestor chain:** ${visited.map((v) => `\`${v}\``).join(" → ")}\n`);
  }
  return md;
}
