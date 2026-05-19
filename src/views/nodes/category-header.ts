import * as vscode from "vscode";
import { PaicNode } from "./base";

/** Non-clickable divider row inserted between kind groups in the tree (D33).
 * Renders as `── <Category> ──` at the same indent level as its sibling
 * nodes. Has no children, no icon, and no `contextValue` that maps to a
 * spawnable kind — selection-handlers explicitly skip it. */
export class CategoryHeaderNode extends PaicNode {
  readonly uid: string;
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.uid = `header:${label}`;
    this.contextValue = "categoryHeader";
  }
  protected loadChildren(): Promise<PaicNode[]> {
    return Promise.resolve([]);
  }
}
