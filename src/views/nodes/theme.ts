import * as vscode from "vscode";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { PaicNode } from "./base";

/** A reference to a UI theme discovered via a `PageNode.stage` themeId.
 * Leaf in the tree; the inspector card fetches metadata via
 * `client.getTheme(realm, themeId)` on selection. */
export class ThemeNode extends PaicNode {
  readonly uid: string;
  constructor(
    public readonly host: string,
    public readonly realm: string,
    public readonly themeId: string,
    // Cache + log carried for inspector-side metadata fetch (panel resolves
    // via the shared ClientCache); the node itself doesn't fetch.
    public readonly cache: ClientCache,
    _log: Logger,
    parent?: PaicNode,
  ) {
    super(themeId, vscode.TreeItemCollapsibleState.None);
    this.parent = parent;
    this.uid = `theme:${host}:${realm}:${themeId}`;
    this.id = this.uid;
    this.contextValue = "theme";
    this.iconPath = new vscode.ThemeIcon("paintcan");
    this.tooltip = buildThemeTooltip(host, realm, themeId);
  }

  protected loadChildren(): Promise<PaicNode[]> {
    return Promise.resolve([] as PaicNode[]);
  }
}

function buildThemeTooltip(host: string, realm: string, themeId: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`### Theme\n\n`);
  md.appendMarkdown(`**Host:** \`${host}\` · **Realm:** \`${realm}\`\n\n`);
  md.appendMarkdown(`**Theme ID:** \`${themeId}\`\n`);
  return md;
}
