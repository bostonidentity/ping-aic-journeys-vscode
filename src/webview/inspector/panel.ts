import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import type { PaicNode } from "../../views/nodes/base";
import { ConnectionNode } from "../../views/nodes/connection";
import { InnerJourneyNode } from "../../views/nodes/inner-journey";
import { JourneyNode } from "../../views/nodes/journey";
import { RealmNode } from "../../views/nodes/realm";
import { ScriptNode } from "../../views/nodes/script";
import type { E2W, NodeInfo, NodeRef, SelectPayload, W2E } from "../messages";

export interface InspectorPanelDeps {
  context: vscode.ExtensionContext;
  cache: ClientCache;
  log: Logger;
  treeView: vscode.TreeView<PaicNode>;
}

/**
 * Singleton webview panel that shows kind-specific info cards for the
 * currently-selected tree node. Lifecycle:
 *   - Lazy-created on first `show(node)`.
 *   - Reused across selections; `retainContextWhenHidden: true` keeps state.
 *   - Disposes itself when the user closes the tab; next `show()` re-creates.
 *
 * Cross-navigation: when the React UI posts `{ type: "navigate", uid }`, we
 * look up the cached `PaicNode` in `uidIndex` and call `treeView.reveal()`.
 * The map is populated as we send selections and dep lists.
 */
export class InspectorPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private readonly uidIndex = new Map<string, PaicNode>();
  private readonly childLog: Logger;

  constructor(private readonly deps: InspectorPanelDeps) {
    this.childLog = deps.log.child({ component: "webview.inspector" });
  }

  /** Reveal panel (creating it if needed) and render `node`. */
  async show(node: PaicNode): Promise<void> {
    this.ensurePanel();
    this.uidIndex.set(node.uid, node);
    const payload = await this.toSelectPayload(node);
    if (!payload) return;
    this.post({ type: "select", payload });

    if (node instanceof JourneyNode || node instanceof InnerJourneyNode) {
      await this.sendJourneyDeps(node);
    }
  }

  /** Open the inspector even if nothing is selected yet. */
  reveal(): void {
    this.ensurePanel();
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
    this.uidIndex.clear();
  }

  // ─── private ─────────────────────────────────────────────────────────────

  private ensurePanel(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    const extensionUri = this.deps.context.extensionUri;
    const panel = vscode.window.createWebviewPanel(
      "paicJourneys.inspector",
      "PAIC Inspector",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out")],
      },
    );
    panel.iconPath = new vscode.ThemeIcon("preview");
    panel.webview.html = this.renderHtml(panel.webview);
    panel.webview.onDidReceiveMessage((m: unknown) => this.onMessage(m));
    panel.onDidDispose(() => {
      this.panel = null;
      this.uidIndex.clear();
      this.childLog.debug({ event: "inspector.closed" }, "Inspector panel disposed");
    });
    this.panel = panel;
    this.childLog.info({ event: "inspector.opened" }, "Inspector panel opened");
  }

  private async sendJourneyDeps(node: JourneyNode | InnerJourneyNode): Promise<void> {
    try {
      const kids = await node.getChildren();
      const scripts: NodeRef[] = [];
      const inners: NodeRef[] = [];
      const scriptUidById = new Map<string, string>();
      const innerUidById = new Map<string, string>();
      for (const k of kids) {
        this.uidIndex.set(k.uid, k);
        if (k instanceof ScriptNode) {
          scripts.push({ uid: k.uid, label: k.scriptId, kind: "script" });
          scriptUidById.set(k.scriptId, k.uid);
        } else if (k instanceof InnerJourneyNode) {
          inners.push({ uid: k.uid, label: k.id, kind: "innerJourney" });
          innerUidById.set(k.id, k.uid);
        }
      }
      const nodeIndex: Record<string, NodeInfo> = {};
      const payloads = node.payloadsByNodeId;
      if (payloads) {
        for (const [nodeId, p] of payloads) {
          if (p.nodeType === "ScriptedDecisionNode" && p.scriptId) {
            nodeIndex[nodeId] = {
              kind: "script",
              scriptId: p.scriptId,
              uid: scriptUidById.get(p.scriptId),
              outcomes: p.outcomes,
              inputs: p.inputs,
              outputs: p.outputs,
            };
          } else if (p.nodeType === "InnerTreeEvaluatorNode" && p.tree) {
            nodeIndex[nodeId] = {
              kind: "inner",
              innerTreeId: p.tree,
              uid: innerUidById.get(p.tree),
            };
          } else {
            nodeIndex[nodeId] = {
              kind: "other",
              rawNodeType: p.nodeType === "other" ? p.rawNodeType : p.nodeType,
            };
          }
        }
      }
      this.post({ type: "journeyDeps", uid: node.uid, scripts, inners, nodeIndex });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.childLog.error(
        { event: "inspector.depsFailed", uid: node.uid, message },
        "Dep fetch failed",
      );
      this.post({ type: "error", uid: node.uid, message });
    }
  }

  private async toSelectPayload(node: PaicNode): Promise<SelectPayload | null> {
    if (node instanceof ConnectionNode) {
      return { kind: "connection", uid: node.uid, connection: node.connection };
    }
    if (node instanceof RealmNode) {
      return { kind: "realm", uid: node.uid, host: node.host, realm: node.realm };
    }
    if (node instanceof JourneyNode) {
      return {
        kind: "journey",
        uid: node.uid,
        host: node.host,
        realmName: node.realm,
        journey: node.journey,
      };
    }
    if (node instanceof InnerJourneyNode) {
      // Fetch the inner-journey's full skeleton so the diagram has nodes to
      // render. Cached on the node (and shared with tree expansion), so the
      // pair of fetches is deduped. On failure, fall back to a placeholder
      // and let the deps message surface the error.
      let journey;
      try {
        journey = await node.ensureJourney();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.childLog.warn(
          { event: "inspector.innerJourney.fetchFailed", uid: node.uid, message },
          "Inner journey skeleton fetch failed — falling back to placeholder",
        );
        journey = { id: node.id, entryNodeId: "", enabled: true, nodes: {} };
      }
      return {
        kind: "innerJourney",
        uid: node.uid,
        host: node.host,
        realmName: node.realm,
        journey,
        visited: node.visited,
      };
    }
    if (node instanceof ScriptNode) {
      return {
        kind: "script",
        uid: node.uid,
        host: node.host,
        realmName: node.realm,
        scriptId: node.scriptId,
      };
    }
    return { kind: "message", uid: node.uid, label: String(node.label ?? "") };
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const bundleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.deps.context.extensionUri, "out", "webview.js"),
    );
    // esbuild emits `out/webview.css` as a sibling of `out/webview.js` when the
    // JS bundle imports any CSS (ReactFlow's stylesheet does, inside
    // JourneyDiagram.tsx). Loading it as a <link> keeps it out of the inlined
    // <style> below.
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.deps.context.extensionUri, "out", "webview.css"),
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource}`,
    ].join("; ");

    // Inline our shell CSS so user-theme CSS variables resolve without
    // round-tripping through a static file. ReactFlow's stylesheet (loaded
    // above) defines its own selectors that don't conflict.
    const css = INSPECTOR_CSS;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>PAIC Inspector</title>
<link rel="stylesheet" href="${stylesUri.toString()}" />
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${bundleUri.toString()}"></script>
</body>
</html>`;
  }

  private post(msg: E2W): void {
    this.panel?.webview.postMessage(msg);
  }

  private async onMessage(msg: unknown): Promise<void> {
    if (!msg || typeof msg !== "object") return;
    const m = msg as W2E;
    if (m.type === "ready") {
      this.childLog.debug({ event: "inspector.ready" }, "Inspector reported ready");
      return;
    }
    if (m.type === "navigate") {
      const target = this.uidIndex.get(m.uid);
      if (!target) {
        this.childLog.warn(
          { event: "inspector.navigate.miss", uid: m.uid },
          "Navigate target not in uid index",
        );
        return;
      }
      try {
        await this.deps.treeView.reveal(target, {
          select: true,
          focus: false,
          expand: false,
        });
        await this.show(target);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.childLog.error(
          { event: "inspector.navigate.failed", uid: m.uid, message },
          "Tree reveal failed",
        );
      }
      return;
    }
    if (m.type === "openScriptBody") {
      this.childLog.debug(
        { event: "inspector.openScriptBody", host: m.host, realm: m.realm, scriptId: m.scriptId },
        "Webview asked to open script body",
      );
      await vscode.commands.executeCommand("paicJourneys.openScriptBody", {
        host: m.host,
        realm: m.realm,
        scriptId: m.scriptId,
        language: m.language,
      });
    }
  }
}

function makeNonce(): string {
  return randomBytes(16)
    .toString("base64")
    .replace(/[^A-Za-z0-9]/g, "");
}

// Inlined to avoid a separate static asset + extra `localResourceRoots` entry.
// Keep in sync with `src/webview/inspector/ui/styles.css` (which exists for
// editor + esbuild's CSS-import path; this constant is what the host actually
// serves into the webview HTML).
const INSPECTOR_CSS = `
:root { color-scheme: light dark; }
body {
  font-family: var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-size: var(--vscode-font-size);
  padding: 16px 20px;
  margin: 0;
}
.empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 24px 0; }
.card-error { color: var(--vscode-errorForeground); border: 1px solid currentColor; padding: 12px 14px; border-radius: 2px; font-size: 0.95em; }
.card { max-width: 720px; }
.card > header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 18px; padding-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); }
.card h1 { font-size: 1.2em; font-weight: 600; margin: 0; word-break: break-word; }
.card h2 { font-size: 1em; font-weight: 600; margin: 18px 0 8px; color: var(--vscode-descriptionForeground); }
.kind-badge { font-size: 0.75em; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--vscode-descriptionForeground); border: 1px solid currentColor; padding: 2px 6px; border-radius: 8px; }
.card dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
.card dt { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
.card dd { margin: 0; word-break: break-word; }
.card code { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; background: var(--vscode-textBlockQuote-background, transparent); padding: 1px 4px; border-radius: 2px; }
.card .hint { margin-top: 16px; color: var(--vscode-descriptionForeground); font-size: 0.85em; font-style: italic; }
.deps-loading, .deps-empty { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); color: var(--vscode-descriptionForeground); }
.deps { margin-top: 18px; padding-top: 6px; border-top: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); }
.deps ul { list-style: none; margin: 0; padding: 0; }
.deps li { margin: 2px 0; }
button.link { background: none; border: none; padding: 0; font: inherit; color: var(--vscode-textLink-foreground); cursor: pointer; text-align: left; }
button.link:hover { text-decoration: underline; color: var(--vscode-textLink-activeForeground); }
.card-actions { margin-top: 16px; }
.card-actions button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid var(--vscode-button-border, transparent); padding: 6px 14px; border-radius: 2px; cursor: pointer; font: inherit; }
.card-actions button.primary:hover { background: var(--vscode-button-hoverBackground); }
.diagram { margin-top: 18px; padding-top: 6px; border-top: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); }
.diagram-empty { margin-top: 18px; color: var(--vscode-descriptionForeground); padding-top: 12px; border-top: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); }
.diag-node { width: 200px; height: 64px; padding: 6px 8px; border: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); border-radius: 4px; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-size: 0.85em; box-sizing: border-box; cursor: pointer; }
.diag-node .kind { font-size: 0.7em; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
.diag-node .label { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diag-node .hint { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.75em; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diag-node.script { border-left: 3px solid var(--vscode-charts-purple, #b180d7); }
.diag-node.inner { border-left: 3px solid var(--vscode-charts-blue, #4f8cc9); }
.diag-node.other { border-left: 3px solid var(--vscode-charts-foreground, #8c8c8c); opacity: 0.85; }
.diag-node.entry { box-shadow: 0 0 0 2px var(--vscode-charts-green, #3c9c3c); }
.diag-node:hover { background: var(--vscode-list-hoverBackground); }
`;
