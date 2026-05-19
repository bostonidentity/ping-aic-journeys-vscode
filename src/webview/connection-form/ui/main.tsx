import { createRoot } from "react-dom/client";
import type { ConnectionFormPayload, W2E } from "../messages";
import { App } from "./App";

// `acquireVsCodeApi` is injected by the VS Code webview host. Two webviews
// in this repo (inspector + connection-form) need it with different W2E
// types — declaring a global with each W2E would conflict, so each bundle
// casts the loosely-typed result locally.
interface ConnectionFormVsCodeApi {
  postMessage(msg: W2E): void;
}
const vscode = (
  window as unknown as { acquireVsCodeApi(): ConnectionFormVsCodeApi }
).acquireVsCodeApi();
const rootEl = document.getElementById("root");
if (rootEl) {
  const raw = rootEl.getAttribute("data-paic-payload");
  let payload: ConnectionFormPayload;
  try {
    payload = raw
      ? (JSON.parse(raw) as ConnectionFormPayload)
      : { mode: "add", initial: null, existingHosts: [] };
  } catch {
    payload = { mode: "add", initial: null, existingHosts: [] };
  }
  createRoot(rootEl).render(<App vscode={vscode} payload={payload} />);
}
