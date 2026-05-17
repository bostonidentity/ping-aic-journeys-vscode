import * as vscode from "vscode";

/**
 * Base class for every tree node we render. Encapsulates:
 *   - per-instance child cache (D8 — reload = clean slate; this lives only in
 *     memory and dies with the extension host).
 *   - template-method `getChildren()` that fans through `loadChildren()` and
 *     wraps thrown errors into a single `MessageNode` so the tree never goes
 *     blank on a fetch failure.
 *   - `refresh()` to drop the cache so the next expansion re-fetches.
 *
 * Subclasses set their own `description`, `tooltip`, `iconPath`, `contextValue`,
 * and `collapsibleState` after `super()`.
 */
export abstract class PaicNode extends vscode.TreeItem {
  /** Stable uid within the parent chain. Used by tests and (M2) globalState. */
  abstract readonly uid: string;

  /** Set by subclasses post-super. Used by `PaicTreeProvider.getParent` so
   * `TreeView.reveal()` can walk the chain to focus a node from anywhere. */
  parent?: PaicNode;

  private childrenPromise: Promise<PaicNode[]> | null = null;

  protected abstract loadChildren(): Promise<PaicNode[]>;

  getChildren(): Promise<PaicNode[]> {
    if (this.childrenPromise) return this.childrenPromise;
    this.childrenPromise = this.loadChildren().catch((err: unknown) => {
      // Drop the failed promise so refresh-or-re-expand can try again.
      this.childrenPromise = null;
      const msg = err instanceof Error ? err.message : String(err);
      return [new MessageNode(`Failed: ${msg}`, "error")];
    });
    return this.childrenPromise;
  }

  refresh(): void {
    this.childrenPromise = null;
  }
}

export type MessageKind = "info" | "error" | "cycle";

/** A non-data leaf used for empty/error/cycle/loading messages. */
export class MessageNode extends PaicNode {
  readonly uid: string;
  constructor(label: string, kind: MessageKind = "info") {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.uid = `msg:${kind}:${label}`;
    this.contextValue = `paic.message.${kind}`;
    const iconIds: Record<MessageKind, string> = {
      error: "error",
      cycle: "sync-ignored",
      info: "info",
    };
    this.iconPath = new vscode.ThemeIcon(iconIds[kind]);
  }
  protected loadChildren(): Promise<PaicNode[]> {
    return Promise.resolve([]);
  }
}
