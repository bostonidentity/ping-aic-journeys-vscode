import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { makeOnpremAuthStrategy } from "../../auth/onprem-strategy";
import { amContextPath } from "../../paic/am-url";
import { mintToken } from "../../paic/auth";
import type { Logger } from "../../util/logger";
import {
  type ConnectionFormData,
  type ConnectionFormInitial,
  type ConnectionFormPayload,
  isW2E,
} from "./messages";

export type { ConnectionFormData, ConnectionFormInitial } from "./messages";

export interface ConnectionFormOptions {
  mode: "add" | "edit";
  initial?: ConnectionFormInitial;
  existingHosts: string[];
  log: Logger;
  /** Edit mode: returns the secret currently stored in SecretStorage for this
   * host (JWK for PAIC, password for on-prem), so the user can validate without
   * re-typing it. Undefined if not stored. The webview never sees the secret —
   * `handleValidate` looks it up here on the extension side. */
  getExistingSecret?: (host: string) => Thenable<string | undefined>;
  /** Called after every Test Connection with its outcome (D40) — the
   * extension records it in the session connection-status store and
   * refreshes the tree icon. */
  onTestResult?: (host: string, ok: boolean) => void;
}

/** Open the Add / Edit Connection form as a WebviewPanel backed by a React
 * bundle (`out/connection-form.js`). Resolves with the form's data on save
 * or `undefined` on cancel / panel disposal. See D34 in
 * `docs/design-plan.md`. */
export function openConnectionForm(
  context: vscode.ExtensionContext,
  opts: ConnectionFormOptions,
): Promise<ConnectionFormData | undefined> {
  const { mode, initial, existingHosts, log, getExistingSecret, onTestResult } = opts;
  const formLog = log.child({ component: "webview.connectionForm" });
  const title = mode === "add" ? "Add Connection" : `Edit Connection — ${initial?.host ?? ""}`;

  const panel = vscode.window.createWebviewPanel(
    "paicJourneys.connectionForm",
    title,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")],
    },
  );

  const payload: ConnectionFormPayload = {
    mode,
    initial: initial ?? null,
    existingHosts,
  };
  panel.webview.html = renderHtml(panel.webview, context, payload);

  return new Promise<ConnectionFormData | undefined>((resolve) => {
    let settled = false;
    const finish = (value: ConnectionFormData | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
      panel.dispose();
    };

    panel.webview.onDidReceiveMessage(async (raw: unknown) => {
      if (!isW2E(raw)) return;
      if (raw.type === "save") {
        formLog.debug({ event: "webview.form.save", host: raw.data.host }, "Form save submitted");
        finish(raw.data);
      } else if (raw.type === "cancel") {
        formLog.debug({ event: "webview.form.cancel" }, "Form cancelled");
        finish(undefined);
      } else if (raw.type === "validate") {
        await handleValidate(
          raw.data,
          raw.requestId,
          panel.webview,
          log,
          getExistingSecret,
          onTestResult,
        );
      }
    });

    panel.onDidDispose(() => finish(undefined));
    context.subscriptions.push(panel);
  });
}

function renderHtml(
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
  payload: ConnectionFormPayload,
): string {
  const nonce = makeNonce();
  const bundleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "out", "connection-form.js"),
  );
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  // HTML attribute encoding for the inline payload — webview is sandboxed
  // and the payload comes from extension code (never user input), but we
  // still escape defensively.
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
<title>Connection</title>
<style>${CONNECTION_FORM_CSS}</style>
</head>
<body>
<div id="root" data-paic-payload="${payloadAttr}"></div>
<script nonce="${nonce}" src="${bundleUri.toString()}"></script>
</body>
</html>`;
}

async function handleValidate(
  data: ConnectionFormData,
  requestId: number,
  webview: vscode.Webview,
  log: Logger,
  getExistingSecret?: (host: string) => Thenable<string | undefined>,
  onTestResult?: (host: string, ok: boolean) => void,
): Promise<void> {
  log.debug(
    { event: "connection.test.start", host: data.host, kind: data.kind },
    "Validating connection",
  );

  if (data.kind === "onprem") {
    await testOnprem(data, requestId, webview, log, getExistingSecret, onTestResult);
    return;
  }

  // PAIC — mint a service-account JWT-bearer token.
  let jwk = data.jwk;
  if (!jwk && getExistingSecret) {
    jwk = await getExistingSecret(data.host);
  }
  if (!jwk) {
    webview.postMessage({
      type: "validateResult",
      requestId,
      ok: false,
      message: "JWK is required to test the connection.",
    });
    return;
  }

  const result = await mintToken({ host: data.host, saId: data.saId, jwk });
  // Record the outcome in the session connection-status store (D40).
  onTestResult?.(data.host, result.ok);
  if (result.ok) {
    log.info(
      {
        event: "connection.test.ok",
        host: data.host,
        expires_in: result.expiresIn,
        dropped_scopes: result.droppedScopes.length,
      },
      "Test Connection succeeded",
    );
    webview.postMessage({
      type: "validateResult",
      requestId,
      ok: true,
      expiresIn: result.expiresIn,
      droppedScopes: result.droppedScopes,
    });
  } else {
    log.error(
      {
        event: "connection.test.failed",
        host: data.host,
        status: result.status,
        error_code: result.error,
      },
      "Test Connection failed",
    );
    webview.postMessage({
      type: "validateResult",
      requestId,
      ok: false,
      message: result.message,
    });
  }
}

/** On-prem Test Connection: authenticate with admin username/password. Success
 * is a returned session cookie; there is no token TTL to report. */
async function testOnprem(
  data: Extract<ConnectionFormData, { kind: "onprem" }>,
  requestId: number,
  webview: vscode.Webview,
  log: Logger,
  getExistingSecret?: (host: string) => Thenable<string | undefined>,
  onTestResult?: (host: string, ok: boolean) => void,
): Promise<void> {
  let password = data.password;
  if (!password && getExistingSecret) {
    password = await getExistingSecret(data.host);
  }
  if (!password) {
    webview.postMessage({
      type: "validateResult",
      requestId,
      ok: false,
      message: "Admin password is required to test the connection.",
    });
    return;
  }

  try {
    const strategy = makeOnpremAuthStrategy({
      host: data.host,
      username: data.username,
      password,
      amPath: amContextPath(data.host),
      log,
    });
    await strategy.getAuthHeaders();
    onTestResult?.(data.host, true);
    log.info(
      { event: "connection.test.ok", host: data.host, kind: "onprem" },
      "Test Connection succeeded",
    );
    webview.postMessage({ type: "validateResult", requestId, ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onTestResult?.(data.host, false);
    log.error(
      { event: "connection.test.failed", host: data.host, kind: "onprem", message },
      "Test Connection failed",
    );
    webview.postMessage({ type: "validateResult", requestId, ok: false, message });
  }
}

function makeNonce(): string {
  return randomBytes(16)
    .toString("base64")
    .replace(/[^A-Za-z0-9]/g, "");
}

const CONNECTION_FORM_CSS = `
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px 32px;
    max-width: 720px;
  }
  h1 {
    font-size: 1.3em;
    margin: 0 0 4px 0;
    font-weight: 600;
  }
  .subtitle {
    color: var(--vscode-descriptionForeground);
    margin-bottom: 24px;
    font-size: 0.9em;
  }
  .field {
    margin-bottom: 18px;
  }
  .group-label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.95em; }
  .kind-toggle { display: flex; gap: 16px; }
  .kind-toggle label { display: inline-flex; align-items: center; gap: 6px; font-weight: normal; margin-bottom: 0; cursor: pointer; }
  .kind-toggle input { width: auto; }
  label {
    display: block;
    font-weight: 600;
    margin-bottom: 6px;
    font-size: 0.95em;
  }
  .required {
    color: var(--vscode-errorForeground);
    margin-left: 2px;
  }
  .hint.optional { font-weight: normal; color: var(--vscode-descriptionForeground); margin-left: 2px; font-size: 0.85em; }
  input, textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  textarea {
    font-family: var(--vscode-editor-font-family, monospace);
    min-height: 140px;
    resize: vertical;
  }
  input:focus, textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .hint {
    color: var(--vscode-descriptionForeground);
    font-size: 0.85em;
    margin-top: 4px;
  }
  .hint.warn::before {
    content: "⚠ ";
  }
  .hint.lock::before {
    content: "🔒 ";
  }
  .error {
    color: var(--vscode-errorForeground);
    font-size: 0.85em;
    margin-top: 4px;
    min-height: 1em;
  }
  .actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border));
  }
  .actions .right {
    display: flex;
    gap: 8px;
  }
  .validate-result {
    margin-top: 12px;
    padding: 8px 10px;
    border-radius: 2px;
    font-size: 0.9em;
  }
  .validate-result.ok {
    color: var(--vscode-testing-iconPassed, var(--vscode-charts-green, #3c9c3c));
    border: 1px solid currentColor;
  }
  .validate-result.err {
    color: var(--vscode-errorForeground);
    border: 1px solid currentColor;
  }
  .validate-result.pending {
    color: var(--vscode-descriptionForeground);
    border: 1px solid currentColor;
  }
  button {
    padding: 6px 14px;
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
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
