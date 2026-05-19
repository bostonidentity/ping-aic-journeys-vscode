import * as vscode from "vscode";
import type { Theme } from "../../domain/types";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { PaicNode } from "./base";

/** A reference to a UI theme discovered via a `PageNode.stage` themeId.
 * Pre-labeled by `journey-expand` per the same pattern as ScriptNode + EsvNode:
 * the resolved Theme is passed in at construction so the tree label is the
 * human name (themeId demoted to TreeItem.description). The inspector card
 * reads `node.resolved` directly — no per-click fetch. */
export class ThemeNode extends PaicNode {
  readonly uid: string;
  readonly resolved?: Theme;
  constructor(
    public readonly host: string,
    public readonly realm: string,
    public readonly themeId: string,
    public readonly cache: ClientCache,
    _log: Logger,
    parent?: PaicNode,
    resolved?: Theme,
  ) {
    const name = resolved?.name || "";
    super(name || themeId, vscode.TreeItemCollapsibleState.None);
    this.parent = parent;
    this.resolved = resolved;
    this.uid = `theme:${host}:${realm}:${themeId}`;
    this.id = this.uid;
    this.contextValue = "theme";
    this.iconPath = new vscode.ThemeIcon("paintcan");
    // When we have a real name, demote the UUID to the description (small
    // dim text beside the label) so both stay discoverable.
    if (name) this.description = resolved?.isDefault ? `${themeId} · default` : themeId;
    this.tooltip = buildThemeTooltip(host, realm, themeId, resolved);
  }

  protected loadChildren(): Promise<PaicNode[]> {
    return Promise.resolve([] as PaicNode[]);
  }
}

function buildThemeTooltip(
  host: string,
  realm: string,
  themeId: string,
  resolved: Theme | undefined,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`### Theme${resolved?.name ? `: \`${resolved.name}\`` : ""}\n\n`);
  md.appendMarkdown(`**Host:** \`${host}\` · **Realm:** \`${realm}\`\n\n`);
  md.appendMarkdown(`**Theme ID:** \`${themeId}\`\n`);
  if (resolved?.isDefault) md.appendMarkdown(`\n**Default theme:** yes\n`);
  if (resolved?.linkedTrees?.length) {
    md.appendMarkdown(`\n**Linked journeys:** ${resolved.linkedTrees.length}\n`);
  }
  return md;
}
