import * as vscode from "vscode";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { PaicNode } from "./base";

/** A reference to a social-identity provider discovered via
 * `SocialProviderHandlerNode*.filteredProviders` or
 * `SelectIdPNode.filteredProviders`. Leaf in the tree; the inspector card
 * resolves metadata via `client.listSocialIdps(realm)` + name match. */
export class SocialIdpNode extends PaicNode {
  readonly uid: string;
  constructor(
    public readonly host: string,
    public readonly realm: string,
    public readonly name: string,
    public readonly cache: ClientCache,
    _log: Logger,
    parent?: PaicNode,
  ) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.parent = parent;
    this.uid = `social-idp:${host}:${realm}:${name}`;
    this.id = this.uid;
    this.contextValue = "socialIdp";
    this.iconPath = new vscode.ThemeIcon("link-external");
    this.tooltip = buildSocialIdpTooltip(host, realm, name);
  }

  protected loadChildren(): Promise<PaicNode[]> {
    return Promise.resolve([] as PaicNode[]);
  }
}

function buildSocialIdpTooltip(host: string, realm: string, name: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`### Social IdP\n\n`);
  md.appendMarkdown(`**Host:** \`${host}\` · **Realm:** \`${realm}\`\n\n`);
  md.appendMarkdown(`**Provider:** \`${name}\`\n`);
  return md;
}
