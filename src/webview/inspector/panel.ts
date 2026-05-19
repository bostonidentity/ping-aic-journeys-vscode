import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { NodePayload } from "../../domain/types";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import type { PaicNode } from "../../views/nodes/base";
import { ConnectionNode } from "../../views/nodes/connection";
import { EmailTemplateNode } from "../../views/nodes/email-template";
import { EsvNode } from "../../views/nodes/esv";
import { InnerJourneyNode } from "../../views/nodes/inner-journey";
import { JourneyNode } from "../../views/nodes/journey";
import { LibraryScriptNode } from "../../views/nodes/library-script";
import { RealmNode } from "../../views/nodes/realm";
import { ScriptNode } from "../../views/nodes/script";
import { SocialIdpNode } from "../../views/nodes/social-idp";
import { ThemeNode } from "../../views/nodes/theme";
import type { E2W, NodeInfo, NodeRef, SelectPayload, W2E } from "../messages";

export interface InspectorFactoryDeps {
  context: vscode.ExtensionContext;
  cache: ClientCache;
  log: Logger;
}

/**
 * Owns the lifecycle of all open `InspectorTab` instances. Per D24, every
 * "show a card" gesture (tree click, card hyperlink click, diagram node
 * click) spawns a fresh `WebviewPanel` — no reuse, no in-place update.
 *
 * Maintains a uid→PaicNode registry populated as tabs fetch their deps,
 * so a tab's `previewNode` message (the user clicking a hyperlink inside a
 * card) can resolve the target node and spawn a new tab for it.
 */
export class InspectorFactory implements vscode.Disposable {
  private readonly tabs = new Set<InspectorTab>();
  private readonly uidIndex = new Map<string, PaicNode>();
  private readonly childLog: Logger;

  constructor(private readonly deps: InspectorFactoryDeps) {
    this.childLog = deps.log.child({ component: "webview.inspector.factory" });
  }

  /** Open a fresh inspector tab for `node`. */
  spawn(node: PaicNode): InspectorTab {
    this.uidIndex.set(node.uid, node);
    const tab = new InspectorTab(
      {
        context: this.deps.context,
        cache: this.deps.cache,
        log: this.deps.log,
        spawnByUid: (uid) => this.spawnByUid(uid),
        registerNode: (n) => this.uidIndex.set(n.uid, n),
        onClosed: (t) => this.tabs.delete(t),
      },
      node,
    );
    this.tabs.add(tab);
    this.childLog.info({ event: "factory.spawn", uid: node.uid }, "Spawned inspector tab");
    return tab;
  }

  /** Forget all known uids — called when the connection registry mutates so
   * stale `previewNode` clicks against now-evicted nodes can't resurrect them. */
  clearRegistry(): void {
    this.uidIndex.clear();
  }

  dispose(): void {
    for (const tab of this.tabs) tab.dispose();
    this.tabs.clear();
    this.uidIndex.clear();
  }

  private spawnByUid(uid: string): void {
    const node = this.uidIndex.get(uid);
    if (!node) {
      this.childLog.warn(
        { event: "factory.spawn.miss", uid },
        "previewNode for unknown uid — no node in registry",
      );
      return;
    }
    this.spawn(node);
  }
}

interface InspectorTabDeps {
  context: vscode.ExtensionContext;
  cache: ClientCache;
  log: Logger;
  /** Called when the webview posts `previewNode` — the factory creates a
   * new tab for that uid. */
  spawnByUid: (uid: string) => void;
  /** Called as tabs discover child nodes (deps blocks) — the factory's
   * uid registry grows so future `previewNode` clicks can resolve. */
  registerNode: (node: PaicNode) => void;
  /** Called when the tab's webview is disposed (user closed the tab). */
  onClosed: (tab: InspectorTab) => void;
}

/**
 * One open inspector tab: one `WebviewPanel`, one card. Constructor creates
 * the panel eagerly and kicks off the initial render. No reuse — closing the
 * tab disposes the panel and removes it from the factory's set.
 *
 * Per D24, in-card link clicks (`previewNode` messages) don't update this
 * tab; they ask the factory to spawn a new tab.
 */
export class InspectorTab implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly childLog: Logger;
  /** Resolves once the initial render + deps fetch complete. Useful for
   * tests; in production code nothing needs to await it. */
  readonly ready: Promise<void>;

  constructor(
    private readonly deps: InspectorTabDeps,
    node: PaicNode,
  ) {
    this.childLog = deps.log.child({ component: "webview.inspector.tab" });
    const extensionUri = deps.context.extensionUri;
    this.panel = vscode.window.createWebviewPanel(
      "paicJourneys.inspector",
      tabTitle(node),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out")],
      },
    );
    this.panel.iconPath = new vscode.ThemeIcon("preview");
    this.panel.webview.html = this.renderHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((m: unknown) => this.onMessage(m));
    this.panel.onDidDispose(() => {
      this.deps.onClosed(this);
      this.childLog.debug({ event: "tab.closed", uid: node.uid }, "Inspector tab disposed");
    });
    this.ready = this.render(node);
  }

  dispose(): void {
    this.panel.dispose();
  }

  // ─── private ─────────────────────────────────────────────────────────────

  private async render(node: PaicNode): Promise<void> {
    this.deps.registerNode(node);
    const payload = await buildSelectPayload(node, this.deps.cache, this.childLog);
    if (!payload) return;
    this.post({ type: "select", payload });

    if (node instanceof JourneyNode || node instanceof InnerJourneyNode) {
      await this.sendJourneyDeps(node);
    } else if (node instanceof ScriptNode || node instanceof LibraryScriptNode) {
      await this.sendScriptDeps(node);
    }
  }

  private async sendJourneyDeps(node: JourneyNode | InnerJourneyNode): Promise<void> {
    try {
      const kids = await node.getChildren();
      const scripts: NodeRef[] = [];
      const inners: NodeRef[] = [];
      const themes: NodeRef[] = [];
      const emailTemplates: NodeRef[] = [];
      const socialIdps: NodeRef[] = [];
      const scriptUidById = new Map<string, string>();
      const scriptNameById = new Map<string, string>();
      const innerUidById = new Map<string, string>();
      const themeUidById = new Map<string, string>();
      const emailUidByName = new Map<string, string>();
      const idpUidByName = new Map<string, string>();
      for (const k of kids) {
        this.deps.registerNode(k);
        if (k instanceof ScriptNode) {
          scripts.push({ uid: k.uid, label: k.scriptName ?? k.scriptId, kind: "script" });
          scriptUidById.set(k.scriptId, k.uid);
          if (k.scriptName) scriptNameById.set(k.scriptId, k.scriptName);
        } else if (k instanceof InnerJourneyNode) {
          inners.push({ uid: k.uid, label: k.id, kind: "innerJourney" });
          innerUidById.set(k.id, k.uid);
        } else if (k instanceof ThemeNode) {
          themes.push({ uid: k.uid, label: k.themeId, kind: "theme" });
          themeUidById.set(k.themeId, k.uid);
        } else if (k instanceof EmailTemplateNode) {
          emailTemplates.push({ uid: k.uid, label: k.name, kind: "emailTemplate" });
          emailUidByName.set(k.name, k.uid);
        } else if (k instanceof SocialIdpNode) {
          socialIdps.push({ uid: k.uid, label: k.name, kind: "socialIdp" });
          idpUidByName.set(k.name, k.uid);
        }
      }
      const nodeIndex: Record<string, NodeInfo> = {};
      const payloads = node.payloadsByNodeId;
      if (payloads) {
        for (const [nodeId, p] of payloads) {
          nodeIndex[nodeId] = buildNodeInfo(p, {
            scriptUidById,
            scriptNameById,
            innerUidById,
            themeUidById,
            emailUidByName,
            idpUidByName,
          });
        }
      }
      this.post({
        type: "journeyDeps",
        uid: node.uid,
        scripts,
        inners,
        themes,
        emailTemplates,
        socialIdps,
        nodeIndex,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.childLog.error(
        { event: "tab.depsFailed", uid: node.uid, message },
        "Journey dep fetch failed",
      );
      this.post({ type: "error", uid: node.uid, message });
    }
  }

  private async sendScriptDeps(node: ScriptNode | LibraryScriptNode): Promise<void> {
    try {
      const kids = await node.getChildren();
      const libraryScripts: NodeRef[] = [];
      const esvs: NodeRef[] = [];
      for (const k of kids) {
        this.deps.registerNode(k);
        if (k instanceof LibraryScriptNode) {
          libraryScripts.push({ uid: k.uid, label: k.name, kind: "libraryScript" });
        } else if (k instanceof EsvNode) {
          esvs.push({ uid: k.uid, label: k.name, kind: "esv" });
        }
      }
      this.post({ type: "scriptDeps", uid: node.uid, libraryScripts, esvs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.childLog.error(
        { event: "tab.scriptDepsFailed", uid: node.uid, message },
        "Script dep fetch failed",
      );
      this.post({ type: "error", uid: node.uid, message });
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const bundleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.deps.context.extensionUri, "out", "webview.js"),
    );
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
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>PAIC Inspector</title>
<link rel="stylesheet" href="${stylesUri.toString()}" />
<style>${INSPECTOR_CSS}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${bundleUri.toString()}"></script>
</body>
</html>`;
  }

  private post(msg: E2W): void {
    this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: unknown): Promise<void> {
    if (!msg || typeof msg !== "object") return;
    const m = msg as W2E;
    if (m.type === "ready") {
      this.childLog.debug({ event: "tab.ready" }, "Inspector tab webview ready");
      return;
    }
    if (m.type === "previewNode") {
      // Any in-card hyperlink click → ask the factory for a new tab.
      this.deps.spawnByUid(m.uid);
      return;
    }
    if (m.type === "openScriptBody") {
      await vscode.commands.executeCommand("paicJourneys.openScriptBody", {
        host: m.host,
        realm: m.realm,
        scriptId: m.scriptId,
        language: m.language,
      });
      return;
    }
    if (m.type === "openEmailTemplateBody") {
      await vscode.commands.executeCommand("paicJourneys.openEmailTemplateBody", {
        host: m.host,
        name: m.name,
        locale: m.locale,
      });
    }
  }
}

function tabTitle(node: PaicNode): string {
  const label = String(node.label ?? node.uid);
  // Truncate to keep the editor tab strip readable.
  const trimmed = label.length > 40 ? `${label.slice(0, 37)}…` : label;
  return `PAIC: ${trimmed}`;
}

/** Build the `select` payload for any `PaicNode`. Shared by `InspectorTab`'s
 * initial render. Async because Inner/Email/Social kinds need to resolve
 * real metadata. */
export async function buildSelectPayload(
  node: PaicNode,
  cache: ClientCache,
  log: Logger,
): Promise<SelectPayload | null> {
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
    let journey;
    try {
      journey = await node.ensureJourney();
    } catch (err) {
      log.warn(
        {
          event: "buildSelectPayload.innerJourney.fetchFailed",
          uid: node.uid,
          message: errMsg(err),
        },
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
      // Pre-resolved during journey-expand's eager fetch — drives the card's
      // name heading + context / description / audit fields.
      script: node.resolved,
    };
  }
  if (node instanceof LibraryScriptNode) {
    return {
      kind: "libraryScript",
      uid: node.uid,
      host: node.host,
      realmName: node.realm,
      scriptId: node.scriptId,
      name: node.name,
      script: node.resolved,
    };
  }
  if (node instanceof EsvNode) {
    return {
      kind: "esv",
      uid: node.uid,
      host: node.host,
      realmName: node.realm,
      name: node.name,
      esv: node.resolved,
    };
  }
  if (node instanceof ThemeNode) {
    return {
      kind: "theme",
      uid: node.uid,
      host: node.host,
      realmName: node.realm,
      themeId: node.themeId,
      theme: node.resolved,
    };
  }
  if (node instanceof EmailTemplateNode) {
    let template;
    try {
      const client = await cache.get(node.host);
      template = (await client.getEmailTemplate(node.name)) ?? undefined;
    } catch (err) {
      log.warn(
        {
          event: "buildSelectPayload.emailTemplate.fetchFailed",
          uid: node.uid,
          message: errMsg(err),
        },
        "Email-template resolution failed — showing name only",
      );
    }
    return {
      kind: "emailTemplate",
      uid: node.uid,
      host: node.host,
      realmName: node.realm,
      name: node.name,
      template,
    };
  }
  if (node instanceof SocialIdpNode) {
    let idp;
    try {
      const client = await cache.get(node.host);
      idp = (await client.getSocialIdp(node.realm, node.name)) ?? undefined;
    } catch (err) {
      log.warn(
        {
          event: "buildSelectPayload.socialIdp.fetchFailed",
          uid: node.uid,
          message: errMsg(err),
        },
        "Social-IdP resolution failed — showing name only",
      );
    }
    return {
      kind: "socialIdp",
      uid: node.uid,
      host: node.host,
      realmName: node.realm,
      name: node.name,
      idp,
    };
  }
  return { kind: "message", uid: node.uid, label: String(node.label ?? "") };
}

function makeNonce(): string {
  return randomBytes(16)
    .toString("base64")
    .replace(/[^A-Za-z0-9]/g, "");
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface UidMaps {
  scriptUidById: ReadonlyMap<string, string>;
  scriptNameById: ReadonlyMap<string, string>;
  innerUidById: ReadonlyMap<string, string>;
  themeUidById: ReadonlyMap<string, string>;
  emailUidByName: ReadonlyMap<string, string>;
  idpUidByName: ReadonlyMap<string, string>;
}

/** Translate a fetched NodePayload into the NodeInfo the diagram + tooltip
 * consume. Same logic as before; lifted out so it can be tested in isolation. */
function buildNodeInfo(p: NodePayload, uids: UidMaps): NodeInfo {
  if (p.nodeType === "ScriptedDecisionNode" && p.scriptId) {
    return {
      kind: "script",
      scriptId: p.scriptId,
      scriptName: uids.scriptNameById.get(p.scriptId),
      uid: uids.scriptUidById.get(p.scriptId),
      outcomes: p.outcomes,
      inputs: p.inputs,
      outputs: p.outputs,
    };
  }
  if (p.nodeType === "InnerTreeEvaluatorNode" && p.tree) {
    return { kind: "inner", innerTreeId: p.tree, uid: uids.innerUidById.get(p.tree) };
  }
  if (p.nodeType === "ClientScriptNode" && p.scriptId) {
    return {
      kind: "script",
      scriptId: p.scriptId,
      scriptName: uids.scriptNameById.get(p.scriptId),
      uid: uids.scriptUidById.get(p.scriptId),
    };
  }
  if (p.nodeType === "ConfigProviderNode") {
    if (p.scriptId) {
      return {
        kind: "script",
        scriptId: p.scriptId,
        scriptName: uids.scriptNameById.get(p.scriptId),
        uid: uids.scriptUidById.get(p.scriptId),
      };
    }
    return { kind: "other", rawNodeType: "ConfigProviderNode" };
  }
  if (p.nodeType === "DeviceMatchNode") {
    if (p.useScript && p.scriptId) {
      return {
        kind: "script",
        scriptId: p.scriptId,
        scriptName: uids.scriptNameById.get(p.scriptId),
        uid: uids.scriptUidById.get(p.scriptId),
        useScript: true,
      };
    }
    return { kind: "other", rawNodeType: "DeviceMatchNode", useScript: p.useScript };
  }
  // biome-ignore lint/security/noSecrets: AIC node type name, not a secret
  if (p.nodeType === "PingOneVerifyCompletionDecisionNode") {
    if (p.useFilterScript && p.scriptId) {
      return {
        kind: "script",
        scriptId: p.scriptId,
        scriptName: uids.scriptNameById.get(p.scriptId),
        uid: uids.scriptUidById.get(p.scriptId),
        useScript: true,
      };
    }
    return {
      kind: "other",
      // biome-ignore lint/security/noSecrets: AIC node type name, not a secret
      rawNodeType: "PingOneVerifyCompletionDecisionNode",
      useScript: p.useFilterScript,
    };
  }
  if (p.nodeType === "SocialProviderHandlerNode" || p.nodeType === "SocialProviderHandlerNodeV2") {
    const socialIdpNames = [...p.filteredProviders];
    if (p.scriptId) {
      return {
        kind: "script",
        scriptId: p.scriptId,
        scriptName: uids.scriptNameById.get(p.scriptId),
        uid: uids.scriptUidById.get(p.scriptId),
        socialIdpNames,
      };
    }
    if (socialIdpNames.length > 0) {
      return { kind: "socialIdp", socialIdpNames, uid: uids.idpUidByName.get(socialIdpNames[0]) };
    }
    return { kind: "other", rawNodeType: p.nodeType };
  }
  if (p.nodeType === "PageNode") {
    if (p.themeId) {
      return { kind: "theme", themeId: p.themeId, uid: uids.themeUidById.get(p.themeId) };
    }
    return { kind: "other", rawNodeType: "PageNode" };
  }
  if (p.nodeType === "EmailSuspendNode" || p.nodeType === "EmailTemplateNode") {
    if (p.emailTemplateName) {
      return {
        kind: "emailTemplate",
        emailTemplateName: p.emailTemplateName,
        uid: uids.emailUidByName.get(p.emailTemplateName),
      };
    }
    return { kind: "other", rawNodeType: p.nodeType };
  }
  if (p.nodeType === "SelectIdPNode") {
    const socialIdpNames = [...p.filteredProviders];
    if (socialIdpNames.length > 0) {
      return { kind: "socialIdp", socialIdpNames, uid: uids.idpUidByName.get(socialIdpNames[0]) };
    }
    return { kind: "other", rawNodeType: "SelectIdPNode" };
  }
  return {
    kind: "other",
    rawNodeType: p.nodeType === "other" ? p.rawNodeType : p.nodeType,
  };
}

// Inlined to avoid a separate static asset + extra `localResourceRoots` entry.
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
.diagram { margin-top: 18px; padding-top: 6px; border-top: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); height: 360px; }
.diagram-empty { margin-top: 18px; color: var(--vscode-descriptionForeground); padding-top: 12px; border-top: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); }
/* When the diagram is expanded, let the containing card stretch beyond its
   normal max-width so the diagram fills the inspector tab. Height is derived
   from a 16:9 aspect ratio of the now-wider container — see D29. :has()
   support is universal in modern Chromium (VS Code's renderer). */
.card:has(.diagram.expanded) { max-width: none; }
.diagram.expanded { height: auto; aspect-ratio: 16 / 9; }
.diag-node { width: 200px; height: 64px; padding: 6px 8px; border: 1.5px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); border-radius: 4px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-foreground); font-size: 0.85em; box-sizing: border-box; cursor: pointer; }
.diag-node .kind { font-size: 0.7em; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
.diag-node .label { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diag-node .hint { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.75em; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Per-kind color stripes (D27). Blue, green, and red are RESERVED for the
   three synthesized terminals (terminal-start, terminal-success,
   terminal-failure). Real journey nodes use other chart/terminal colors so
   they don't collide visually with terminals. */
.diag-node.script { border-left: 5px solid var(--vscode-charts-purple, #b180d7); }
.diag-node.inner { border-left: 5px solid var(--vscode-terminal-ansiCyan, #06989a); }
.diag-node.other { border-left: 5px solid var(--vscode-charts-foreground, #8c8c8c); opacity: 0.85; }
.diag-node.page { border-left: 5px solid var(--vscode-charts-orange, #d18616); }
.diag-node.email { border-left: 5px solid var(--vscode-charts-yellow, #c9b73a); }
.diag-node.social { border-left: 5px solid var(--vscode-terminal-ansiMagenta, #cc66cc); }
.diag-node.select-idp { border-left: 5px solid var(--vscode-terminal-ansiMagenta, #cc66cc); opacity: 0.9; }
.diag-node.device-match { border-left: 5px solid var(--vscode-terminal-ansiCyan, #06989a); opacity: 0.95; }
.diag-node.config-provider { border-left: 5px solid var(--vscode-charts-purple, #b180d7); opacity: 0.9; }
.diag-node.client-script { border-left: 5px solid var(--vscode-charts-purple, #b180d7); opacity: 0.9; }
.diag-node.verify { border-left: 5px solid var(--vscode-terminal-ansiMagenta, #cc66cc); opacity: 0.9; }
/* Terminals — exclusive owners of blue / green / red. */
.diag-node.terminal-start { border-left: 5px solid var(--vscode-charts-blue, #4f8cc9); }
.diag-node.terminal-success { border-left: 5px solid var(--vscode-charts-green, #6c9b34); }
.diag-node.terminal-failure { border-left: 5px solid var(--vscode-charts-red, #c93636); }
/* ReactFlow defaults ship hardcoded grays/whites — override to track VS Code theme. */
.diagram .react-flow__edge-path,
.diagram .react-flow__connection-path { stroke: var(--vscode-editor-foreground); stroke-opacity: 0.55; }
.diagram .react-flow__edge-textbg { fill: var(--vscode-editorWidget-background, var(--vscode-editor-background)); }
.diagram .react-flow__edge-text { fill: var(--vscode-foreground); }
.diagram .react-flow__background-pattern { color: var(--vscode-editorIndentGuide-background, #555); }
.diagram .react-flow__controls { background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); border: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); box-shadow: none; }
.diagram .react-flow__controls-button { background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-foreground); border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); }
.diagram .react-flow__controls-button:hover { background: var(--vscode-list-hoverBackground); }
.diagram .react-flow__controls-button svg { fill: var(--vscode-foreground); }
/* Keyboard focus rings on every interactive element — required for a11y and works across themes. */
button.link:focus-visible,
.card-actions button:focus-visible,
.diag-node:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
.theme-swatch { display: inline-flex; align-items: center; gap: 6px; }
.theme-swatch-dot { display: inline-block; width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); }
.theme-logo { margin-top: 18px; padding-top: 6px; border-top: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); }
.theme-logo-img { max-width: 240px; max-height: 80px; background: var(--vscode-editor-background); padding: 6px; border: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); border-radius: 4px; }
`;
