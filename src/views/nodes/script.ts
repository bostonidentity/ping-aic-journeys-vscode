import * as vscode from "vscode";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { MessageNode, PaicNode } from "./base";
import { expandScript } from "./script-expand";

/**
 * A script node. Expandable since M3 Slice 2 — `loadChildren()` fetches the
 * script body, runs D20's regex extractors, and emits `LibraryScriptNode` +
 * `EsvNode` children. The script body fetch is cached on the instance and
 * reused by both expansion and (future) the inspector card's content fetch.
 */
export class ScriptNode extends PaicNode {
  readonly uid: string;
  private bodyPromise?: Promise<string>;

  constructor(
    public readonly host: string,
    public readonly realm: string,
    public readonly scriptId: string,
    private readonly cache: ClientCache,
    private readonly log: Logger,
    parent?: PaicNode,
    /** Cycle-detection chain — populated when this ScriptNode was discovered
     * as a recursive child of another script's expansion. Top-level scripts
     * (discovered via journey-expand) pass `[]`. */
    public readonly visited: readonly string[] = [],
  ) {
    super(scriptId, vscode.TreeItemCollapsibleState.Collapsed);
    this.parent = parent;
    this.uid = `script:${host}:${realm}:${scriptId}`;
    this.id = this.uid;
    this.contextValue = "script";
    this.iconPath = new vscode.ThemeIcon("symbol-method");
    this.tooltip = buildScriptTooltip(host, realm, scriptId);
  }

  /** Lazy-fetch + cache the script body. Shared in-flight Promise so
   * concurrent expand + future inspector-card reads dedupe. */
  ensureBody(): Promise<string> {
    if (!this.bodyPromise) {
      this.bodyPromise = this.fetchBody().catch((err: unknown) => {
        this.bodyPromise = undefined;
        throw err;
      });
    }
    return this.bodyPromise;
  }

  private async fetchBody(): Promise<string> {
    const client = await this.cache.get(this.host);
    const script = await client.getScript(this.realm, this.scriptId);
    return script.body;
  }

  protected async loadChildren(): Promise<PaicNode[]> {
    const body = await this.ensureBody();
    return expandScript({
      host: this.host,
      realm: this.realm,
      body,
      selfKey: this.scriptId,
      visited: this.visited,
      cache: this.cache,
      log: this.log,
      parent: this,
    });
  }

  refresh(): void {
    // Clear both the body cache and the parent's child-cache.
    this.bodyPromise = undefined;
    super.refresh();
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
