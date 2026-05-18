import * as vscode from "vscode";
import type { Esv } from "../../domain/types";
import { PaicNode } from "./base";

export type EsvKind = "variable" | "secret" | "missing";

/** A reference to a tenant-scoped Environment-Specific Variable (ESV)
 * discovered as a `'esv.x.y'` string literal in a script body (D20).
 *
 * Pre-labeled at construction with `kind` + `resolved` per D22 — script-expand
 * fetches `listVariables` + `listSecrets` once per expansion and classifies
 * each ref before constructing the node. Tree icon differs by kind. The
 * inspector card reads `resolved` directly without any extra fetch.
 *
 * `kind === "missing"` means the regex captured a name that's not in the
 * tenant (either a false-positive from the parser, or an ESV that was
 * recently deleted from the admin console). Kept visible in the tree
 * because we can't always distinguish those two cases. */
export class EsvNode extends PaicNode {
  readonly uid: string;
  readonly kind?: EsvKind;
  readonly resolved?: Esv;
  constructor(
    public readonly host: string,
    public readonly realm: string,
    public readonly name: string,
    parent?: PaicNode,
    kind?: EsvKind,
    resolved?: Esv,
  ) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.parent = parent;
    this.kind = kind;
    this.resolved = resolved;
    // ESVs are tenant-scoped, but our tree is realm-rooted so we include
    // realm in the uid to keep paths-from-different-realms distinct in
    // the uidIndex.
    this.uid = `esv:${host}:${realm}:${name}`;
    this.id = this.uid;
    this.contextValue = kind === "missing" ? "esvMissing" : "esv";
    this.iconPath = new vscode.ThemeIcon(iconFor(kind));
    if (kind === "missing") this.description = "(not in tenant)";
    this.tooltip = buildEsvTooltip(host, name, kind);
  }

  protected loadChildren(): Promise<PaicNode[]> {
    return Promise.resolve([] as PaicNode[]);
  }
}

function iconFor(kind: EsvKind | undefined): string {
  if (kind === "secret") return "lock";
  if (kind === "missing") return "warning";
  // "variable" and the unlabeled fallback share the variable icon.
  return "symbol-variable";
}

function labelFor(kind: EsvKind | undefined): string {
  if (kind === "variable") return "ESV Variable";
  if (kind === "secret") return "ESV Secret";
  if (kind === "missing") return "ESV (not in tenant)";
  return "ESV";
}

function buildEsvTooltip(
  host: string,
  name: string,
  kind: EsvKind | undefined,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`### ${labelFor(kind)}\n\n`);
  md.appendMarkdown(`**Name:** \`${name}\`\n\n`);
  md.appendMarkdown(`**Host:** \`${host}\`\n`);
  return md;
}
