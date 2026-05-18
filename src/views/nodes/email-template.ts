import * as vscode from "vscode";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { PaicNode } from "./base";

/** A reference to an IDM email template discovered via an `EmailSuspendNode`
 * or `EmailTemplateNode` payload's `emailTemplateName` field. Leaf in the
 * tree; the inspector card resolves metadata via
 * `client.getEmailTemplate(name)` on selection. */
export class EmailTemplateNode extends PaicNode {
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
    // Email templates are tenant-scoped; we keep realm in the uid so paths
    // remain distinct even though resolution is realm-independent.
    this.uid = `email-template:${host}:${realm}:${name}`;
    this.id = this.uid;
    this.contextValue = "emailTemplate";
    this.iconPath = new vscode.ThemeIcon("mail");
    this.tooltip = buildEmailTemplateTooltip(host, realm, name);
  }

  protected loadChildren(): Promise<PaicNode[]> {
    return Promise.resolve([] as PaicNode[]);
  }
}

function buildEmailTemplateTooltip(
  host: string,
  realm: string,
  name: string,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`### Email template\n\n`);
  md.appendMarkdown(`**Host:** \`${host}\` · **Realm:** \`${realm}\`\n\n`);
  md.appendMarkdown(`**Template name:** \`${name}\`\n`);
  return md;
}
