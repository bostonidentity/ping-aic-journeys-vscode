import * as vscode from "vscode";
import { PaicNode } from "./base";

/** A reference to a tenant-scoped Environment-Specific Variable (ESV)
 * discovered via `&{esv.X}` or `systemEnv.X` in a script body (D20).
 *
 * Leaf at M3 Slice 2 — the tree shows the bare name. ESV metadata
 * (variable vs secret, expression type, last-modified date) requires a
 * separate cloud-env API call (`/environment/variables/<name>` or
 * `/environment/secrets/<name>`), which lands in M3 polish or later. */
export class EsvNode extends PaicNode {
  readonly uid: string;
  constructor(
    public readonly host: string,
    public readonly realm: string,
    public readonly name: string,
    parent?: PaicNode,
  ) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.parent = parent;
    // ESVs are tenant-scoped, but our tree is realm-rooted so we include
    // realm in the uid to keep paths-from-different-realms distinct in
    // the uidIndex.
    this.uid = `esv:${host}:${realm}:${name}`;
    this.id = this.uid;
    this.contextValue = "esv";
    this.iconPath = new vscode.ThemeIcon("symbol-variable");
    this.tooltip = buildEsvTooltip(host, name);
  }

  protected loadChildren(): Promise<PaicNode[]> {
    return Promise.resolve([] as PaicNode[]);
  }
}

function buildEsvTooltip(host: string, name: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`### ESV\n\n`);
  md.appendMarkdown(`**Name:** \`${name}\`\n\n`);
  md.appendMarkdown(`**Host:** \`${host}\`\n`);
  return md;
}
