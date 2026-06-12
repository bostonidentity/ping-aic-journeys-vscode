import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { runEsvApply } from "../../import/apply";
import type { ComponentVerdict } from "../../import/compare";
import { runExecute, type WritePlanItem, type WriteResult } from "../../import/execute";
import { WRITABLE_KINDS } from "../../import/kinds";
import type { ImportComponent } from "../../import/parse";
import { parseBundle } from "../../import/parse";
import { runPreflight } from "../../import/preflight";
import { idpNeedsSecret } from "../../import/write";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { COMBOBOX_CSS } from "../shared/combobox-css";
import {
  type ConnectionInfo,
  type E2W,
  isW2E,
  type ParsedBundle,
  type TransferPayload,
} from "./messages";

/** Connections read fresh on every spawn so the payload reflects the current
 * registry state (used by the Slice-B target dropdown). */
export interface TransferFactoryDeps {
  context: vscode.ExtensionContext;
  listConnections: () => readonly ConnectionInfo[];
  /** Mints/caches a PaicClient per host — used to list a target's realms. */
  cache: ClientCache;
  /** Connection kind for a host — drives the realm-list root filter. */
  connectionKindOf: (host: string) => "paic" | "onprem" | undefined;
  log: Logger;
}

/**
 * Owns the lifecycle of the singleton Transfer webview (TD-6). Re-invoking
 * `spawn()` focuses the existing tab and re-renders it with the fresh
 * connection list. Slice A is read-only: load a bundle file and preview it.
 */
export class TransferFactory implements vscode.Disposable {
  private tab: TransferTab | null = null;
  private readonly childLog: Logger;

  constructor(private readonly deps: TransferFactoryDeps) {
    this.childLog = deps.log.child({ component: "webview.transfer.factory" });
  }

  /** Open or focus the (singleton) Transfer page. */
  spawn(): TransferTab {
    const payload: TransferPayload = { connections: this.deps.listConnections() };
    if (this.tab) {
      this.tab.refresh(payload);
      this.tab.reveal();
      this.childLog.debug({ event: "factory.spawn.focus" }, "Focused existing Transfer tab");
      return this.tab;
    }
    this.tab = new TransferTab(
      {
        context: this.deps.context,
        cache: this.deps.cache,
        connectionKindOf: this.deps.connectionKindOf,
        log: this.deps.log,
        onClosed: () => {
          this.tab = null;
        },
      },
      payload,
    );
    this.childLog.info({ event: "factory.spawn" }, "Spawned Transfer tab");
    return this.tab;
  }

  dispose(): void {
    this.tab?.dispose();
    this.tab = null;
  }
}

interface TransferTabDeps {
  context: vscode.ExtensionContext;
  cache: ClientCache;
  connectionKindOf: (host: string) => "paic" | "onprem" | undefined;
  log: Logger;
  onClosed: (tab: TransferTab) => void;
}

export class TransferTab implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly childLog: Logger;
  /** The currently-loaded bundle (extension-side). `rawComponents` carries the
   * raw export objects for the compare — never crosses postMessage. Survives a
   * webview remount (`refresh()` / re-`spawn()`); the summary is re-posted on
   * the next `ready`. */
  private loaded: {
    fileName: string;
    bundle: ParsedBundle;
    rawComponents: ImportComponent[];
  } | null = null;

  constructor(
    private readonly deps: TransferTabDeps,
    payload: TransferPayload,
  ) {
    this.childLog = deps.log.child({ component: "webview.transfer.tab" });
    this.panel = vscode.window.createWebviewPanel(
      "paicJourneys.transfer",
      "PAIC Transfer",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(deps.context.extensionUri, "out")],
      },
    );
    this.panel.iconPath = new vscode.ThemeIcon("cloud-upload");
    this.panel.webview.html = this.renderHtml(this.panel.webview, payload);
    this.panel.webview.onDidReceiveMessage((m: unknown) => this.onMessage(m));
    this.panel.onDidDispose(() => {
      this.deps.onClosed(this);
      this.childLog.debug({ event: "tab.closed" }, "Transfer tab disposed");
    });
    this.childLog.info({ event: "tab.opened" }, "Transfer tab opened");
  }

  dispose(): void {
    this.panel.dispose();
  }

  reveal(): void {
    this.panel.reveal(this.panel.viewColumn, true);
  }

  /** Re-render with a fresh payload (new connection list). The webview reads
   * the embedded payload on mount — re-rendering is simpler than a dedicated
   * setPayload message. */
  refresh(payload: TransferPayload): void {
    this.panel.webview.html = this.renderHtml(this.panel.webview, payload);
  }

  // ─── private ─────────────────────────────────────────────────────────────

  private async onMessage(raw: unknown): Promise<void> {
    if (!isW2E(raw)) return;
    if (raw.type === "ready") {
      this.childLog.debug({ event: "tab.ready" }, "Transfer webview ready");
      // Re-hydrate the preview after a webview remount (refresh / re-spawn).
      if (this.loaded) {
        this.post({
          type: "bundleLoaded",
          fileName: this.loaded.fileName,
          bundle: this.loaded.bundle,
        });
      }
      return;
    }
    if (raw.type === "listRealms") {
      await this.handleListRealms(raw.host);
      return;
    }
    if (raw.type === "runPreflight") {
      await this.handleRunPreflight(raw.host, raw.realm);
      return;
    }
    if (raw.type === "execute") {
      await this.handleExecute(raw.host, raw.realm);
      return;
    }
    if (raw.type === "applyEsv") {
      await this.handleApplyEsv(raw.host);
      return;
    }
    if (raw.type === "pickBundle") {
      await this.handlePickBundle();
    }
  }

  /** Apply pending ESV changes — a tenant-wide environment restart (TD-7). The
   * one write here is the restart POST; progress is polled + streamed to the
   * webview (host-keyed, durable). */
  private async handleApplyEsv(host: string): Promise<void> {
    try {
      const client = await this.deps.cache.get(host);
      const pick = await vscode.window.showWarningMessage(
        "Apply pending ESV changes?",
        {
          modal: true,
          detail:
            `This restarts the ${host} runtime (~3–10 minutes) and applies ALL pending ESV ` +
            "changes tenant-wide — not just the ones you imported. No further ESV updates are " +
            "possible until it finishes, and this can't be undone.",
        },
        "Apply",
      );
      if (pick !== "Apply") {
        this.post({ type: "applyResult", host, ok: false, elapsedS: 0, message: "Cancelled." });
        return;
      }
      this.childLog.info({ event: "tab.applyEsv.start", host }, "Applying ESV changes (restart)");
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Applying ESV changes…" },
        (progress) =>
          runEsvApply(client, {
            onProgress: (status, elapsedS) => {
              progress.report({ message: `${status} (${elapsedS}s)` });
              this.post({ type: "applyProgress", host, status, elapsedS });
            },
          }),
      );
      this.post({
        type: "applyResult",
        host,
        ok: result.ok,
        elapsedS: result.elapsedS,
        ...(result.ok ? {} : { message: `final status: ${result.finalStatus}` }),
      });
      this.childLog.info(
        { event: "tab.applyEsv.done", host, ok: result.ok, elapsed_s: result.elapsedS },
        "ESV apply finished",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.childLog.error({ event: "tab.applyEsv.failed", host, message }, "ESV apply failed");
      this.post({ type: "applyResult", host, ok: false, elapsedS: 0, message });
    }
  }

  /** Read-only compare pre-flight: fetch each loaded component's current
   * version on the target and classify it. No writes. */
  private async handleRunPreflight(host: string, realm: string): Promise<void> {
    if (!this.loaded) return;
    const targetKind = this.deps.connectionKindOf(host) ?? "paic";
    try {
      const client = await this.deps.cache.get(host);
      const verdicts = await runPreflight(client, realm, targetKind, this.loaded.rawComponents);
      this.post({ type: "preflightResult", host, realm, verdicts });
      this.childLog.info(
        { event: "tab.runPreflight", host, realm, verdict_count: verdicts.length },
        "Ran import pre-flight",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.childLog.error(
        { event: "tab.runPreflight.failed", host, realm, message },
        "Pre-flight failed",
      );
      this.post({ type: "preflightError", host, realm, message });
    }
  }

  /** Execute the import (D43) — the ONLY method that mutates a tenant.
   * Re-validates fresh, confirms, collects idp secrets, writes sequentially,
   * reports per-component, then refreshes the Plan. */
  private async handleExecute(host: string, realm: string): Promise<void> {
    if (!this.loaded) return;
    const targetKind = this.deps.connectionKindOf(host) ?? "paic";
    try {
      const client = await this.deps.cache.get(host);
      // Validate-before-first-write: a FRESH pre-flight, not the shown Plan.
      const verdicts = await runPreflight(client, realm, targetKind, this.loaded.rawComponents);
      const rawByKey = new Map(this.loaded.rawComponents.map((c) => [`${c.kind}:${c.id}`, c]));

      const items: WritePlanItem[] = [];
      for (const v of verdicts) {
        if (v.status !== "new" && v.status !== "differs") continue;
        if (!WRITABLE_KINDS.has(v.kind)) continue; // Slice C = atoms only
        const component = rawByKey.get(`${v.kind}:${v.id}`);
        if (!component) {
          this.childLog.warn(
            { event: "tab.execute.noRaw", kind: v.kind, id: v.id },
            "Verdict has no matching raw component — skipping",
          );
          continue;
        }
        items.push({ component, verdict: v.status });
      }
      const createN = items.filter((i) => i.verdict === "new").length;
      const overwriteN = items.filter((i) => i.verdict === "differs").length;
      const errorN = verdicts.filter((v) => v.status === "error").length;

      if (items.length === 0) {
        this.post({
          type: "executeResult",
          host,
          realm,
          results: [],
          summary: "Nothing to import — all components are identical or unsupported.",
        });
        return;
      }

      // Confirm modal — fresh counts, names the exact target, no-undo warning.
      const hasEsv = items.some(
        (i) => i.component.kind === "variable" || i.component.kind === "secret",
      );
      const detail =
        `Import to ${host} / realm ${realm} — create ${createN}, overwrite ${overwriteN}. ` +
        "Overwrite replaces the target's current version entirely; this cannot be undone." +
        (errorN > 0 ? ` ${errorN} component(s) couldn't be checked and will be skipped.` : "") +
        (hasEsv ? " ESV changes require a separate Apply step before they take effect." : "");
      const pick = await vscode.window.showWarningMessage(
        "Write these components to the tenant?",
        { modal: true, detail },
        "Import",
      );
      if (pick !== "Import") {
        this.post({ type: "executeResult", host, realm, results: [], summary: "Cancelled." });
        return;
      }

      // Collect re-supplied secrets AFTER the confirm. A cancelled box → that
      // component is skipped by runExecute (never a blank write).
      for (const item of items) {
        if (item.component.kind === "socialIdp" && idpNeedsSecret(item.component.raw)) {
          item.secret = await vscode.window.showInputBox({
            password: true,
            ignoreFocusOut: true,
            title: "Re-supply social-IdP client secret",
            prompt: `clientSecret for "${item.component.displayName}" (redacted in the bundle)`,
          });
        } else if (item.component.kind === "secret") {
          item.secret = await vscode.window.showInputBox({
            password: true,
            ignoreFocusOut: true,
            title: "Supply ESV secret value",
            prompt: `Value for ESV secret "${item.component.displayName}" (not in the bundle)`,
          });
        }
      }

      this.childLog.info(
        { event: "tab.execute.start", host, realm, create: createN, overwrite: overwriteN },
        "Importing components",
      );
      const results = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Importing components…" },
        () => runExecute(client, realm, items),
      );
      const count = (s: WriteResult["status"]) => results.filter((r) => r.status === s).length;
      const summary = `${count("created")} created · ${count("overwritten")} overwritten · ${count("skipped")} skipped · ${count("failed")} failed`;
      this.post({ type: "executeResult", host, realm, results, summary });
      this.childLog.info(
        { event: "tab.execute.done", host, realm, failed: count("failed") },
        "Import complete",
      );

      // Refresh the Plan (written components should now read Identical).
      const fresh = await runPreflight(client, realm, targetKind, this.loaded.rawComponents);
      this.post({ type: "preflightResult", host, realm, verdicts: fresh });
      this.warnOnDrift(results, fresh);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.childLog.error({ event: "tab.execute.failed", host, realm, message }, "Import failed");
      this.post({
        type: "executeResult",
        host,
        realm,
        results: [],
        summary: `Import failed: ${message}`,
      });
    }
  }

  /** Warn if a just-written component still reads Differs on the refreshed
   * Plan — a sign the write transform and the compare normalization disagree. */
  private warnOnDrift(results: WriteResult[], fresh: ComponentVerdict[]): void {
    const wrote = new Set(
      results
        .filter((r) => r.status === "created" || r.status === "overwritten")
        .map((r) => `${r.kind}:${r.id}`),
    );
    for (const v of fresh) {
      if (v.status === "differs" && wrote.has(`${v.kind}:${v.id}`)) {
        this.childLog.warn(
          { event: "tab.execute.drift", kind: v.kind, id: v.id },
          "Just-written component still reads Differs — write/compare transform drift",
        );
      }
    }
  }

  /** List a target connection's realms for the Target dropdown. Mirrors the
   * Search panel: drop the platform root for PAIC (service accounts 403 on it);
   * keep root for on-prem (journeys live there). */
  private async handleListRealms(host: string): Promise<void> {
    try {
      const client = await this.deps.cache.get(host);
      const realms = await client.listRealms();
      const isOnprem = this.deps.connectionKindOf(host) === "onprem";
      const usable = realms
        .filter((r) => (isOnprem ? true : !r.isRoot && r.name !== "/"))
        .map((r) => r.name);
      this.post({ type: "realmsResult", host, realms: usable });
      this.childLog.debug(
        { event: "tab.listRealms", host, realm_count: usable.length },
        "Listed realms",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.childLog.error(
        { event: "tab.listRealms.failed", host, message },
        "Failed to list realms",
      );
      this.post({ type: "realmsError", host, message });
    }
  }

  /** Open a file picker, read + parse the chosen bundle, and post the summary
   * back. All read-only and local — no network, no writes (Slice A). */
  private async handlePickBundle(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { "PAIC export bundle": ["json"] },
      openLabel: "Inspect",
    });
    if (!picked || picked.length === 0) {
      this.childLog.debug({ event: "tab.pickBundle.cancelled" }, "Bundle pick cancelled");
      return;
    }
    const uri = picked[0];
    const fileName = uri.path.split("/").pop() ?? uri.path;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder().decode(bytes);
      const result = parseBundle(text);
      if (!result.ok) {
        this.childLog.warn(
          { event: "tab.pickBundle.parseError", file: fileName },
          "Bundle parse failed",
        );
        this.post({ type: "bundleError", message: result.error });
        return;
      }
      this.loaded = {
        fileName,
        bundle: result.bundle,
        rawComponents: result.rawComponents,
      };
      this.childLog.info(
        { event: "tab.pickBundle", file: fileName, kind: result.bundle.kind },
        "Loaded bundle for preview",
      );
      this.post({ type: "bundleLoaded", fileName, bundle: result.bundle });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.childLog.error(
        { event: "tab.pickBundle.failed", file: fileName, message },
        "Failed to read bundle file",
      );
      this.post({ type: "bundleError", message: `Couldn't read the file. ${message}` });
    }
  }

  private post(msg: E2W): void {
    this.panel.webview.postMessage(msg);
  }

  private renderHtml(webview: vscode.Webview, payload: TransferPayload): string {
    const nonce = makeNonce();
    const bundleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.deps.context.extensionUri, "out", "transfer.js"),
    );
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.deps.context.extensionUri, "out", "codicon.css"),
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    const payloadAttr = JSON.stringify(payload)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Transfer</title>
<link rel="stylesheet" href="${codiconUri.toString()}" />
<style>${TRANSFER_CSS}</style>
</head>
<body>
<div id="root" data-paic-payload="${payloadAttr}"></div>
<script nonce="${nonce}" src="${bundleUri.toString()}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  return randomBytes(16)
    .toString("base64")
    .replace(/[^A-Za-z0-9]/g, "");
}

const TRANSFER_CSS = `
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px 24px;
    margin: 0;
  }
  h1 {
    font-size: 1.2em;
    margin: 0 0 4px 0;
    font-weight: 600;
  }
  .transfer-subtitle {
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
    margin-bottom: 16px;
  }
  button {
    padding: 4px 12px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    cursor: pointer;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  button:hover {
    background: var(--vscode-button-hoverBackground);
  }
  button:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .transfer-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .transfer-file {
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
  }
  .transfer-hint {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    padding: 12px 0;
  }
  .transfer-error {
    color: var(--vscode-errorForeground);
    border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
    background: var(--vscode-inputValidation-errorBackground, transparent);
    border-radius: 4px;
    padding: 10px 14px;
    margin-bottom: 12px;
  }
  .transfer-source {
    border: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border));
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border-radius: 4px;
    padding: 14px 16px;
  }
  .transfer-chip {
    display: inline-block;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    font-size: 0.85em;
    font-weight: 600;
    border-radius: 10px;
    padding: 2px 10px;
    margin-bottom: 12px;
  }
  .transfer-meta {
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: 4px 12px;
    margin: 0 0 12px 0;
    font-size: 0.9em;
  }
  .transfer-meta dt {
    color: var(--vscode-descriptionForeground);
    font-weight: 600;
  }
  .transfer-meta dd {
    margin: 0;
    word-break: break-all;
  }
  .transfer-inventory {
    list-style: none;
    margin: 0 0 12px 0;
    padding: 0;
    font-size: 0.9em;
    color: var(--vscode-foreground);
  }
  .transfer-inventory li {
    padding: 2px 0;
  }
  .transfer-components-header {
    color: var(--vscode-descriptionForeground);
    font-size: 0.82em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border));
    padding-bottom: 2px;
    margin-bottom: 4px;
  }
  .transfer-components {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .transfer-components li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 3px 0;
  }
  .transfer-comp-detail {
    color: var(--vscode-descriptionForeground);
    font-size: 0.85em;
  }
  .transfer-section-title {
    font-weight: 600;
    margin: 18px 0 6px;
  }
  .transfer-note {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    padding: 12px 0;
  }
  .transfer-scope {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 8px 12px;
    align-items: center;
    border: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border));
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border-radius: 4px;
    padding: 12px 16px;
  }
  .transfer-scope .field-label {
    font-weight: 600;
    font-size: 0.9em;
  }
  .transfer-compat {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    font-size: 0.92em;
  }
  .transfer-compat li {
    padding: 3px 0;
  }
  .transfer-v-ok {
    color: var(--vscode-testing-iconPassed, var(--vscode-foreground));
  }
  .transfer-v-new {
    color: var(--vscode-foreground);
  }
  .transfer-v-diff {
    color: var(--vscode-editorWarning-foreground, var(--vscode-foreground));
  }
  .transfer-v-muted {
    color: var(--vscode-descriptionForeground);
  }
  .transfer-v-bad {
    color: var(--vscode-errorForeground);
  }
  ${COMBOBOX_CSS}
`;
