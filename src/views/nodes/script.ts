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
    this.contextValue = "script";
    this.iconPath = new vscode.ThemeIcon("symbol-method");
    this.tooltip = `Script ${scriptId} in realm ${realm}`;
  }

  protected loadChildren(): Promise<PaicNode[]> {
    return Promise.resolve([] as PaicNode[]);
  }
}

// Re-export for symmetry with the other node files (consumers can `import
// { ScriptNode, MessageNode } from "./script"` if they want); keeps the
// barrel-free layout consistent.
export { MessageNode };
