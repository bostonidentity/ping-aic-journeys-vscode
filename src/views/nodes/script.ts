import * as vscode from "vscode";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { MessageNode, PaicNode } from "./base";

/**
 * A script leaf. At M1 a script is a leaf — the detail panel (next dev-task)
 * shows its metadata; M2 renders the body; M3 expands into library scripts
 * discovered via `require()` calls.
 */
export class ScriptNode extends PaicNode {
  readonly uid: string;
  constructor(
    public readonly host: string,
    public readonly realm: string,
    public readonly scriptId: string,
    // Kept for future use (M3 library-script expansion). Underscore-prefixed
    // to silence "unused parameter" lints while preserving the constructor
    // shape this task locks in.
    _cache: ClientCache,
    _log: Logger,
    parent?: PaicNode,
  ) {
    super(scriptId, vscode.TreeItemCollapsibleState.None);
    this.parent = parent;
    this.uid = `script:${host}:${realm}:${scriptId}`;
    // Leaves don't have collapse state, but setting `id` still helps VS Code
    // keep selection identity stable across refreshes.
    this.id = this.uid;
    this.contextValue = "script";
    this.iconPath = new vscode.ThemeIcon("symbol-method");
    this.tooltip = buildScriptTooltip(host, realm, scriptId);
  }

  protected loadChildren(): Promise<PaicNode[]> {
    return Promise.resolve([] as PaicNode[]);
  }
}

function buildScriptTooltip(host: string, realm: string, scriptId: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`### Script\n\n`);
  md.appendMarkdown(`**Host:** \`${host}\` · **Realm:** \`${realm}\`\n\n`);
  md.appendMarkdown(`**Script ID:** \`${scriptId}\`\n`);
  return md;
}

// Re-export for symmetry with the other node files (consumers can `import
// { ScriptNode, MessageNode } from "./script"` if they want); keeps the
// barrel-free layout consistent.
export { MessageNode };
