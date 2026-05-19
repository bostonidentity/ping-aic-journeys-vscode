import * as vscode from "vscode";
import { PaicNode } from "./base";

/** Non-clickable divider row inserted between kind groups in the tree (D33).
 * Renders as `── <Category> (<count>) ──` at the same indent level as its
 * sibling nodes. Has no children, no icon, and no `contextValue` that
 * maps to a spawnable kind — selection-handlers explicitly skip it.
 *
 * As of 2026-05-19 the divider is emitted **even when a single kind is
 * present** — the original D33 "skip-when-single-kind" carve-out hid
 * structure in deeper transitive views and made copy-pasted text
 * unreadable. The sidebar and Full / Flat now follow the same rule:
 * always emit, always include the count. */
export class CategoryHeaderNode extends PaicNode {
  readonly uid: string;
  constructor(kindLabel: string, count: number) {
    super(`── ${kindLabel} (${count}) ──`, vscode.TreeItemCollapsibleState.None);
    this.uid = `header:${kindLabel}`;
    this.contextValue = "categoryHeader";
  }
  protected loadChildren(): Promise<PaicNode[]> {
    return Promise.resolve([]);
  }
}
