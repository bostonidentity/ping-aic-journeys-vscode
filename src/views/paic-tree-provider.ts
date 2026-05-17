import * as vscode from "vscode";
import type { PaicNode } from "./nodes/base";

/**
 * Element-driven `TreeDataProvider`. Each tree node owns its own
 * `getChildren()` so this provider is mechanical: at the root it delegates
 * to `rootSource`; for any other element it delegates to the node itself.
 * Refreshes fire `_onDidChangeTreeData(node)` so VS Code re-reads only that
 * subtree (or, with no arg, the whole tree).
 */
export class PaicTreeProvider implements vscode.TreeDataProvider<PaicNode> {
  private _onDidChange = new vscode.EventEmitter<PaicNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly rootSource: () => PaicNode[]) {}

  getTreeItem(node: PaicNode): vscode.TreeItem {
    return node;
  }

  getChildren(node?: PaicNode): Promise<PaicNode[]> {
    return node ? node.getChildren() : Promise.resolve(this.rootSource());
  }

  /** Required by `TreeView.reveal()` so VS Code can walk to a target node. */
  getParent(node: PaicNode): PaicNode | undefined {
    return node.parent;
  }

  reload(node?: PaicNode): void {
    this._onDidChange.fire(node);
  }
}
