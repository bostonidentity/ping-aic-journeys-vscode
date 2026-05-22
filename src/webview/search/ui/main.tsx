import { createRoot } from "react-dom/client";
import type { SearchPayload, W2E } from "../messages";
import { App } from "./App";

// Each webview bundle in this repo (inspector / connection-form / search)
// has its own W2E discriminated union, so we declare the cast locally
// rather than rely on a single global declaration.
interface SearchVsCodeApi {
  postMessage(msg: W2E): void;
}
const vscode = (window as unknown as { acquireVsCodeApi(): SearchVsCodeApi }).acquireVsCodeApi();

const DEFAULT_PAYLOAD: SearchPayload = {
  connections: [],
  selectedHost: null,
  selectedRealm: null,
  prefill: null,
};

const rootEl = document.getElementById("root");
if (rootEl) {
  const raw = rootEl.getAttribute("data-paic-payload");
  let payload: SearchPayload;
  try {
    payload = raw ? (JSON.parse(raw) as SearchPayload) : DEFAULT_PAYLOAD;
  } catch {
    payload = DEFAULT_PAYLOAD;
  }
  createRoot(rootEl).render(<App vscode={vscode} payload={payload} />);
}
