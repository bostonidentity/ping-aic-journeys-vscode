import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { mintToken } from "../paic/auth";

export interface ConnectionFormData {
  host: string;
  saId: string;
  name?: string;
  jwk?: string;
}

export interface ConnectionFormInitial {
  host: string;
  saId: string;
  name?: string;
}

export interface ConnectionFormOptions {
  mode: "add" | "edit";
  initial?: ConnectionFormInitial;
  existingHosts: string[];
  log: vscode.LogOutputChannel;
  // Edit mode: returns the JWK currently stored in SecretStorage for this host,
  // so the user can validate without re-pasting it. Undefined if not stored.
  getExistingJwk?: (host: string) => Thenable<string | undefined>;
}

export function openConnectionForm(
  context: vscode.ExtensionContext,
  opts: ConnectionFormOptions,
): Promise<ConnectionFormData | undefined> {
  const { mode, initial, existingHosts, log, getExistingJwk } = opts;
  const title = mode === "add" ? "Add Connection" : `Edit Connection — ${initial?.host ?? ""}`;

  const panel = vscode.window.createWebviewPanel(
    "paicJourneys.connectionForm",
    title,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  panel.webview.html = renderHtml(panel.webview, {
    mode,
    initial,
    existingHosts,
  });

  return new Promise<ConnectionFormData | undefined>((resolve) => {
    let settled = false;
    const finish = (value: ConnectionFormData | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
      panel.dispose();
    };

    panel.webview.onDidReceiveMessage(
      async (msg: { type: string; data?: ConnectionFormData; requestId?: number }) => {
        if (msg.type === "save" && msg.data) {
          log.debug(`connectionForm: save host=${msg.data.host}`);
          finish(msg.data);
        } else if (msg.type === "cancel") {
          log.debug("connectionForm: cancel");
          finish(undefined);
        } else if (msg.type === "validate" && msg.data) {
          await handleValidate(msg.data, msg.requestId, panel.webview, log, getExistingJwk);
        }
      },
    );

    panel.onDidDispose(() => finish(undefined));

    context.subscriptions.push(panel);
  });
}

function renderHtml(
  webview: vscode.Webview,
  opts: {
    mode: "add" | "edit";
    initial?: ConnectionFormInitial;
    existingHosts: string[];
  },
): string {
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  const payload = JSON.stringify({
    mode: opts.mode,
    initial: opts.initial ?? null,
    existingHosts: opts.existingHosts,
  }).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Connection</title>
<style>
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
    display: none;
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
</style>
</head>
<body>
  <h1 id="title"></h1>
  <div class="subtitle" id="subtitle"></div>

  <div class="field">
    <label for="name">Display name <span class="hint" style="font-weight:normal">(optional)</span></label>
    <input id="name" type="text" placeholder="e.g. prod-tenant" />
  </div>

  <div class="field">
    <label for="host">Host<span class="required">*</span></label>
    <input id="host" type="text" placeholder="openam-tenant.example.forgeblocks.com" />
    <div class="hint warn">host is the stable ID; renaming it moves the stored secret</div>
    <div class="error" id="host-error"></div>
  </div>

  <div class="field">
    <label for="saId">Service Account ID<span class="required">*</span></label>
    <input id="saId" type="text" placeholder="00000000-0000-0000-0000-000000000000" />
    <div class="error" id="saId-error"></div>
  </div>

  <div class="field">
    <label for="jwk">Service Account JWK (JSON)<span class="required" id="jwk-required">*</span></label>
    <textarea id="jwk" spellcheck="false" placeholder="Paste the service-account JWK JSON here"></textarea>
    <div class="hint lock">stored in VS Code SecretStorage</div>
    <div class="hint" id="jwk-edit-hint" style="display:none">leave blank to keep the existing JWK</div>
    <div class="error" id="jwk-error"></div>
  </div>

  <div class="actions">
    <button class="secondary" id="test">Test Connection</button>
    <div class="right">
      <button class="secondary" id="cancel">Cancel</button>
      <button id="save">Save</button>
    </div>
  </div>
  <div class="validate-result" id="validate-result"></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const init = ${payload};

  const isEdit = init.mode === "edit";
  document.getElementById("title").textContent = isEdit ? "Edit Connection" : "Add Connection";
  document.getElementById("subtitle").textContent = isEdit
    ? "Update this connection's metadata. Leave the JWK blank to keep the existing secret."
    : "Add a new PAIC tenant connection. The JWK is stored in VS Code SecretStorage.";

  const nameEl = document.getElementById("name");
  const hostEl = document.getElementById("host");
  const saIdEl = document.getElementById("saId");
  const jwkEl = document.getElementById("jwk");

  if (init.initial) {
    nameEl.value = init.initial.name ?? "";
    hostEl.value = init.initial.host ?? "";
    saIdEl.value = init.initial.saId ?? "";
  }

  if (isEdit) {
    document.getElementById("jwk-required").style.display = "none";
    document.getElementById("jwk-edit-hint").style.display = "block";
  }

  const errors = {
    host: document.getElementById("host-error"),
    saId: document.getElementById("saId-error"),
    jwk: document.getElementById("jwk-error"),
  };

  function clearErrors() {
    errors.host.textContent = "";
    errors.saId.textContent = "";
    errors.jwk.textContent = "";
  }

  function validate() {
    clearErrors();
    let ok = true;

    const host = hostEl.value.trim();
    const saId = saIdEl.value.trim();
    const name = nameEl.value.trim();
    const jwk = jwkEl.value.trim();

    if (!host) {
      errors.host.textContent = "Host is required.";
      ok = false;
    } else {
      const dup = init.existingHosts.includes(host) &&
        !(isEdit && init.initial && init.initial.host === host);
      if (dup) {
        errors.host.textContent = "A connection with this host already exists.";
        ok = false;
      }
    }

    if (!saId) {
      errors.saId.textContent = "Service Account ID is required.";
      ok = false;
    }

    if (isEdit) {
      if (jwk) {
        try { JSON.parse(jwk); }
        catch { errors.jwk.textContent = "JWK must be valid JSON."; ok = false; }
      }
    } else {
      if (!jwk) {
        errors.jwk.textContent = "JWK is required.";
        ok = false;
      } else {
        try { JSON.parse(jwk); }
        catch { errors.jwk.textContent = "JWK must be valid JSON."; ok = false; }
      }
    }

    return ok ? { host, saId, name: name || undefined, jwk: jwk || undefined } : null;
  }

  document.getElementById("save").addEventListener("click", () => {
    const data = validate();
    if (data) vscode.postMessage({ type: "save", data });
  });

  document.getElementById("cancel").addEventListener("click", () => {
    vscode.postMessage({ type: "cancel" });
  });

  const testBtn = document.getElementById("test");
  const resultEl = document.getElementById("validate-result");
  let pendingRequestId = 0;

  function showResult(cls, text) {
    resultEl.className = "validate-result " + cls;
    resultEl.textContent = text;
    resultEl.style.display = "block";
  }

  testBtn.addEventListener("click", () => {
    const data = validate();
    if (!data) return;
    pendingRequestId += 1;
    testBtn.disabled = true;
    showResult("pending", "Testing connection…");
    vscode.postMessage({ type: "validate", data, requestId: pendingRequestId });
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "validateResult") return;
    if (msg.requestId !== pendingRequestId) return;
    testBtn.disabled = false;
    if (msg.ok) {
      const dropped = Array.isArray(msg.droppedScopes) ? msg.droppedScopes : [];
      const dropSuffix = dropped.length
        ? " (some scopes not granted: " + dropped.join(", ") + ")"
        : "";
      showResult("ok", "✓ Connected. Token valid for " + (msg.expiresIn || "?") + "s." + dropSuffix);
    } else {
      showResult("err", "✗ " + (msg.message || "Validation failed."));
    }
  });

  hostEl.focus();
</script>
</body>
</html>`;
}

async function handleValidate(
  data: ConnectionFormData,
  requestId: number | undefined,
  webview: vscode.Webview,
  log: vscode.LogOutputChannel,
  getExistingJwk?: (host: string) => Thenable<string | undefined>,
): Promise<void> {
  log.debug(`connectionForm: validate host=${data.host}`);
  let jwk = data.jwk;
  if (!jwk && getExistingJwk) {
    jwk = await getExistingJwk(data.host);
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
  if (result.ok) {
    log.info(
      `validateConnection: ok host=${data.host} expiresIn=${result.expiresIn} droppedScopes=${result.droppedScopes.length}`,
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
      `validateConnection: failed host=${data.host} status=${result.status ?? "?"} error=${result.error ?? "?"}`,
    );
    webview.postMessage({
      type: "validateResult",
      requestId,
      ok: false,
      message: result.message,
    });
  }
}

function makeNonce(): string {
  return randomBytes(16)
    .toString("base64")
    .replace(/[^A-Za-z0-9]/g, "");
}
