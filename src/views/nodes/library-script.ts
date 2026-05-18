import * as vscode from "vscode";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { PaicNode } from "./base";
import { expandScript } from "./script-expand";

/** A library script discovered via `require('<name>')` in another script's
 * body (D20). Same expansion shape as a top-level script — `loadChildren()`
 * parses this script's body for further requires + ESV references and
 * recurses. The `visited` set tracks library-script names along the chain
 * for cycle detection. */
export class LibraryScriptNode extends PaicNode {
  readonly uid: string;
  constructor(
    public readonly host: string,
    public readonly realm: string,
    public readonly scriptId: string,
    public readonly name: string,
    /** Body is provided up-front by `expandScript` (it had to fetch it via
     * `getScriptByName` to resolve the name → UUID, so we reuse the body
     * instead of re-fetching). */
    public readonly body: string,
    private readonly cache: ClientCache,
    private readonly log: Logger,
    public readonly visited: readonly string[],
    parent?: PaicNode,
  ) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.parent = parent;
    this.uid = `library-script:${host}:${realm}:${name}:${visited.join(",")}`;
    this.contextValue = "libraryScript";
    this.iconPath = new vscode.ThemeIcon("library");
    this.tooltip = buildLibraryScriptTooltip(host, realm, name, visited);
  }

  protected loadChildren(): Promise<PaicNode[]> {
    return expandScript({
      host: this.host,
      realm: this.realm,
      body: this.body,
      selfKey: this.name,
      visited: this.visited,
      cache: this.cache,
      log: this.log,
      parent: this,
    });
  }
}

function buildLibraryScriptTooltip(
  host: string,
  realm: string,
  name: string,
  visited: readonly string[],
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`### Library script: \`${name}\`\n\n`);
  md.appendMarkdown(`**Host:** \`${host}\` · **Realm:** \`${realm}\`\n\n`);
  if (visited.length > 0) {
    md.appendMarkdown(`**Ancestor chain:** ${visited.map((v) => `\`${v}\``).join(" → ")}\n`);
  }
  return md;
}
