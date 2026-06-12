import { createRoot } from "react-dom/client";
import type { TransferPayload, W2E } from "../messages";
import { App } from "./App";

// Each webview bundle in this repo declares its own W2E-typed vscode API
// rather than relying on a single global declaration.
interface TransferVsCodeApi {
  postMessage(msg: W2E): void;
}
const vscode = (window as unknown as { acquireVsCodeApi(): TransferVsCodeApi }).acquireVsCodeApi();

const DEFAULT_PAYLOAD: TransferPayload = { connections: [] };

const rootEl = document.getElementById("root");
if (rootEl) {
  const raw = rootEl.getAttribute("data-paic-payload");
  let payload: TransferPayload;
  try {
    payload = raw ? (JSON.parse(raw) as TransferPayload) : DEFAULT_PAYLOAD;
  } catch {
    payload = DEFAULT_PAYLOAD;
  }
  createRoot(rootEl).render(<App vscode={vscode} payload={payload} />);
}
